from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

from .config import ToolConfig


REQUIRED_CANONICAL = ("timestamp", "temperature", "target", "pump", "mode", "status", "fault")
EXCLUDED_DIRECTORIES = {
    "node_modules", ".cache", ".angular", ".next", ".nuxt", ".svelte-kit",
    ".vite", ".turbo", "dist", "build", "coverage", "out", "target",
    ".gradle", ".m2", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache",
    ".parcel-cache", ".prisma", ".expo", "managed_components",
}


@dataclass
class Dataset:
    frame: pd.DataFrame
    files: list[dict[str, Any]]
    quality: dict[str, Any]
    dataset_hash: str


def discover_csvs(inputs: Iterable[Path]) -> list[Path]:
    files: set[Path] = set()
    for input_path in inputs:
        resolved = input_path.resolve()
        if resolved.is_dir():
            for directory, names, filenames in os.walk(resolved):
                names[:] = [name for name in names if name not in EXCLUDED_DIRECTORIES]
                files.update(Path(directory) / filename for filename in filenames if filename.lower().endswith(".csv"))
        elif resolved.is_file() and resolved.suffix.lower() == ".csv":
            files.add(resolved)
        else:
            raise ValueError(f"CSV input does not exist or is not a CSV: {input_path}")
    if not files:
        raise ValueError("No CSV inputs were found.")
    return sorted(files)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _first_alias(columns: set[str], aliases: list[str]) -> str | None:
    return next((candidate for candidate in aliases if candidate in columns), None)


def _boolean(series: pd.Series, name: str) -> pd.Series:
    if pd.api.types.is_bool_dtype(series):
        return series.astype(float)
    normalized = series.astype("string").str.strip().str.lower()
    mapping = {
        "true": 1.0, "false": 0.0, "1": 1.0, "0": 0.0,
        "on": 1.0, "off": 0.0, "running": 1.0, "idle": 0.0,
        "enabled": 1.0, "disabled": 0.0,
    }
    result = normalized.map(mapping)
    numeric = pd.to_numeric(series, errors="coerce")
    result = result.fillna(numeric)
    invalid = result.notna() & ~result.between(0.0, 1.0)
    if invalid.any():
        raise ValueError(f"{name} contains values outside 0..1")
    return result.astype(float)


def _normalize(raw: pd.DataFrame, config: ToolConfig, path: Path, file_hash: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    frame = raw.copy()
    frame.columns = [str(column).strip() for column in frame.columns]
    columns = set(frame.columns)
    selected = {name: _first_alias(columns, aliases) for name, aliases in config.aliases.items()}
    missing = [name for name in REQUIRED_CANONICAL if selected.get(name) is None]
    if missing:
        raise ValueError(f"{path.name}: missing required columns: {', '.join(missing)}")
    if selected.get("heater_duty") is None and selected.get("heater_active") is None:
        raise ValueError(f"{path.name}: requires heater duty/command or heater-active state")

    normalized = pd.DataFrame(index=frame.index)
    normalized["timestamp"] = pd.to_datetime(frame[selected["timestamp"]], utc=True, errors="coerce")
    numeric_names = ("temperature", "temperature_raw", "temperature_filtered", "target", "heater_duty", "baseline_duty", "uptime_ms")
    for name in numeric_names:
        source = selected.get(name)
        normalized[name] = pd.to_numeric(frame[source], errors="coerce") if source else np.nan
    normalized["heater_active"] = _boolean(frame[selected["heater_active"]], "heater_active") if selected.get("heater_active") else np.nan
    normalized["pump"] = _boolean(frame[selected["pump"]], "pump")
    for name in ("mode", "status", "fault", "device_id"):
        source = selected.get(name)
        normalized[name] = frame[source].astype("string").fillna("").str.strip() if source else ""

    diagnostic_columns = [
        "temperature_slope_c_per_s", "temperature_acceleration_c_per_s2",
        "heat_5s", "heat_15s", "heat_30s", "pump_5s", "pump_15s",
        "predicted_temperature_5s_c", "predicted_temperature_10s_c",
        "predicted_temperature_20s_c", "prediction_operating_mode",
        "prediction_usable", "prediction_model_version",
        "prediction_feature_schema_version", "prediction_training_data_hash",
    ]
    for column in diagnostic_columns:
        normalized[f"logged_{column}"] = frame[column] if column in frame else np.nan
    normalized["source_file"] = str(path)
    normalized["source_file_name"] = path.name
    normalized["source_hash"] = file_hash
    normalized["source_row"] = np.arange(len(frame), dtype=np.int64)

    exact_duplicate_count = int(frame.duplicated().sum())
    duplicate_timestamp_count = int(normalized["timestamp"].duplicated(keep=False).sum())
    non_monotonic = bool(normalized["timestamp"].dropna().is_monotonic_increasing is False)
    valid_times = normalized["timestamp"].dropna().sort_values()
    intervals = valid_times.diff().dt.total_seconds().dropna()
    positive = intervals[intervals > 0]
    expected_interval = config.sampling.expected_interval_seconds or (float(positive.median()) if len(positive) else np.nan)

    normalized = normalized.loc[~frame.duplicated()].copy()
    normalized = normalized.sort_values(["timestamp", "source_row"], kind="stable", na_position="last").reset_index(drop=True)
    report = {
        "path": str(path),
        "sha256": file_hash,
        "rows_read": int(len(frame)),
        "rows_after_exact_deduplication": int(len(normalized)),
        "exact_duplicates_removed": exact_duplicate_count,
        "duplicate_timestamp_rows": duplicate_timestamp_count,
        "missing_timestamps": int(normalized["timestamp"].isna().sum()),
        "non_monotonic_input": non_monotonic,
        "expected_interval_seconds": expected_interval if np.isfinite(expected_interval) else None,
        "heater_duty_source": selected.get("heater_duty"),
        "boolean_heater_fallback": selected.get("heater_duty") is None,
        "scale_columns_available": any(column in columns for column in ("beverage_weight_g", "weight", "flow_rate_g_s", "flow_rate")),
        "aliases": {key: value for key, value in selected.items() if value is not None},
    }
    return normalized, report


def _split_sessions(frame: pd.DataFrame, config: ToolConfig, file_reports: list[dict[str, Any]]) -> pd.DataFrame:
    output: list[pd.DataFrame] = []
    expected_by_file = {report["path"]: report["expected_interval_seconds"] for report in file_reports}
    for source_file, group in frame.groupby("source_file", sort=False):
        group = group.copy().reset_index(drop=True)
        delta = group["timestamp"].diff().dt.total_seconds()
        uptime_delta = group["uptime_ms"].diff()
        expected = expected_by_file[source_file]
        threshold = config.sampling.session_gap_multiplier * expected if expected else np.inf
        boundary = group["timestamp"].isna() | (delta <= 0) | (delta > threshold) | (uptime_delta < 0)
        boundary.iloc[0] = True
        group["session_number"] = boundary.cumsum().astype(int)
        short_hash = str(group["source_hash"].iloc[0])[:12]
        group["session_id"] = group["session_number"].map(lambda number: f"{short_hash}-{number:04d}")
        group["sample_interval_seconds"] = delta
        output.append(group)
    return pd.concat(output, ignore_index=True)


def load_dataset(inputs: Iterable[Path], config: ToolConfig) -> Dataset:
    csvs = discover_csvs(inputs)
    frames: list[pd.DataFrame] = []
    reports: list[dict[str, Any]] = []
    for path in csvs:
        file_hash = _sha256(path)
        raw = pd.read_csv(path, low_memory=False)
        normalized, report = _normalize(raw, config, path, file_hash)
        frames.append(normalized)
        reports.append(report)
    frame = _split_sessions(pd.concat(frames, ignore_index=True), config, reports)
    joined_hashes = "\n".join(report["sha256"] for report in reports).encode("ascii")
    dataset_hash = hashlib.sha256(joined_hashes).hexdigest()
    quality = validate_dataset(frame, reports, config)
    return Dataset(frame=frame, files=reports, quality=quality, dataset_hash=dataset_hash)


def validate_dataset(frame: pd.DataFrame, reports: list[dict[str, Any]], config: ToolConfig) -> dict[str, Any]:
    temperature = frame["temperature"]
    target = frame["target"]
    interval = frame["sample_interval_seconds"]
    rate = frame.groupby("session_id", sort=False)["temperature"].diff().abs() / interval
    faulted = frame["fault"].fillna("").astype(str).str.len() > 0
    constant_rows = 0
    for _, session in frame.groupby("session_id", sort=False):
        rolling_span = session["temperature"].rolling(30, min_periods=30).max() - session["temperature"].rolling(30, min_periods=30).min()
        constant_rows += int((rolling_span < 0.01).sum())
    warnings: list[str] = []
    if any(report["boolean_heater_fallback"] for report in reports):
        warnings.append("Actual heater duty is unavailable for one or more files; Boolean heater state will be used with reduced plant-model confidence.")
    if len(frame["session_id"].unique()) < config.validation.minimum_groups_for_promotion:
        warnings.append("Too few independent sessions for model promotion.")
    session_durations = frame.groupby("session_id")["timestamp"].agg(lambda values: (values.max() - values.min()).total_seconds())
    short_sessions = int((session_durations < config.sampling.minimum_session_seconds).sum())
    if short_sessions:
        warnings.append(f"{short_sessions} session(s) are too short for training.")
    interval_values = interval[interval > 0].dropna()
    statuses = sorted(value for value in frame["status"].dropna().astype(str).str.lower().unique() if value)
    known_statuses = {"heating", "ready", "fault", "cooldown", "stabilizing"}
    return {
        "files": reports,
        "rows": int(len(frame)),
        "sessions": int(frame["session_id"].nunique()),
        "missing_temperature": int(temperature.isna().sum()),
        "invalid_temperature": int(((temperature < 0) | (temperature > config.validation.maximum_valid_temperature_c)).sum()),
        "missing_target": int(target.isna().sum()),
        "invalid_heater_duty": int((~frame["heater_duty"].dropna().between(0, 1)).sum()),
        "invalid_pump": int((~frame["pump"].dropna().between(0, 1)).sum()),
        "implausible_temperature_jumps": int((rate > config.validation.maximum_temperature_jump_c_per_s).sum()),
        "faulted_rows": int(faulted.sum()),
        "long_constant_sensor_rows": constant_rows,
        "sessions_too_short": short_sessions,
        "sample_interval_seconds": {
            "minimum": float(interval_values.min()) if len(interval_values) else None,
            "median": float(interval_values.median()) if len(interval_values) else None,
            "p95": float(interval_values.quantile(0.95)) if len(interval_values) else None,
            "maximum": float(interval_values.max()) if len(interval_values) else None,
        },
        "status_labels": statuses,
        "unrecognized_status_labels": sorted(set(statuses) - known_statuses),
        "warnings": warnings,
    }
