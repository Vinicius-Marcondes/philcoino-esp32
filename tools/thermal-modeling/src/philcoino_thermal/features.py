from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import ToolConfig


FEATURE_ORDER = [
    "temperature_filtered_c", "target_temperature_c", "temperature_error_c",
    "temperature_slope_c_per_s", "heat_5s", "heat_15s", "heat_30s",
    "pump_5s", "pump_15s", "baseline_heater_duty", "operating_mode",
]

MODE_CODE = {"warmup": 0.0, "idle_stable": 1.0, "brewing": 2.0, "post_brew_recovery": 3.0, "fault": 4.0}


@dataclass
class _CommandInterval:
    end_ms: int
    duration_ms: int
    heater: bool
    pump: bool


def _activity(history: deque[_CommandInterval], now_ms: int, window_ms: int, heater: bool) -> float:
    window_start = now_ms - window_ms
    active_ms = 0
    for interval in history:
        if not (interval.heater if heater else interval.pump):
            continue
        start = interval.end_ms - interval.duration_ms
        if interval.end_ms <= window_start:
            continue
        active_ms += interval.end_ms - max(start, window_start)
    return active_ms / 1000.0


def _mode(row: pd.Series) -> str:
    logged = str(row.get("logged_prediction_operating_mode", "")).strip().lower()
    if logged in MODE_CODE:
        return logged
    if str(row.get("fault", "")).strip():
        return "fault"
    if float(row.get("pump", 0) or 0) > 0:
        return "brewing"
    status = str(row.get("status", "")).lower()
    return "idle_stable" if status == "ready" else "warmup"


class IncrementalFirmwareFeatures:
    """Stateful, firmware-equivalent feature calculator used by fitting and simulation."""

    def __init__(self, config: ToolConfig) -> None:
        self.config = config
        self.command_history: deque[_CommandInterval] = deque(maxlen=128)
        self.temperature_history: deque[tuple[int, float, float, bool]] = deque(maxlen=16)
        self.initialized = False
        self.filter_initialized = False
        self.previous_ms = 0
        self.filtered_raw = 0.0
        self.previous_mode: str | None = None
        self.previous_target: float | None = None

    def reset(self) -> None:
        self.command_history.clear(); self.temperature_history.clear()
        self.initialized = False; self.filter_initialized = False

    def update(self, row: pd.Series, now_ms: int) -> dict[str, float | bool | str]:
        active_mode = str(row["mode"]).lower()
        target = float(row["target"]) if pd.notna(row["target"]) else np.nan
        if self.previous_mode is not None and (active_mode != self.previous_mode or target != self.previous_target):
            self.reset()
        self.previous_mode, self.previous_target = active_mode, target
        valid_timing = True
        if self.initialized:
            interval_ms = now_ms - self.previous_ms
            if interval_ms < self.config.features.minimum_interval_ms or interval_ms > self.config.features.maximum_interval_ms:
                self.reset(); valid_timing = False
            else:
                heater_value = row["heater_active"] if pd.notna(row["heater_active"]) else row["heater_duty"]
                self.command_history.append(_CommandInterval(now_ms, interval_ms, bool(float(heater_value or 0) > 0), bool(float(row["pump"] or 0) > 0)))
        self.initialized = True; self.previous_ms = now_ms
        raw_available = pd.notna(row["temperature_raw"])
        raw = float(row["temperature_raw"] if raw_available else row["temperature"])
        heat5 = _activity(self.command_history, now_ms, 5000, True)
        heat15 = _activity(self.command_history, now_ms, 15000, True)
        heat30 = _activity(self.command_history, now_ms, 30000, True)
        pump5 = _activity(self.command_history, now_ms, 5000, False)
        pump15 = _activity(self.command_history, now_ms, 15000, False)
        if not np.isfinite(raw):
            self.filter_initialized = False; self.temperature_history.clear()
            return {"temperature_filtered_c": np.nan, "target_temperature_c": target, "temperature_error_c": np.nan,
                    "temperature_slope_c_per_s": 0.0, "temperature_acceleration_c_per_s2": 0.0,
                    "heat_5s": heat5, "heat_15s": heat15, "heat_30s": heat30, "pump_5s": pump5, "pump_15s": pump15,
                    "baseline_heater_duty": 0.0, "operating_mode_name": "fault", "operating_mode": MODE_CODE["fault"], "feature_valid": False}
        if not self.filter_initialized:
            self.filtered_raw = raw; self.filter_initialized = True
        else:
            alpha = self.config.features.filter_alpha
            self.filtered_raw = alpha * raw + (1.0 - alpha) * self.filtered_raw
        offset = self.config.controller.steam_temperature_offset_c if raw_available and active_mode == "steam" else 0.0
        filtered = self.filtered_raw + offset
        slope = 0.0; slope_valid = False
        for at_ms, prior_temperature, _, _ in self.temperature_history:
            elapsed_ms = now_ms - at_ms
            if elapsed_ms >= 3000:
                slope = (filtered - prior_temperature) / (elapsed_ms / 1000.0); slope_valid = np.isfinite(slope); break
        acceleration = 0.0
        if slope_valid:
            for at_ms, _, prior_slope, prior_valid in self.temperature_history:
                elapsed_ms = now_ms - at_ms
                if prior_valid and elapsed_ms >= 3000:
                    acceleration = (slope - prior_slope) / (elapsed_ms / 1000.0); break
        self.temperature_history.append((now_ms, filtered, slope, slope_valid))
        coverage_ms = (self.command_history[-1].end_ms - self.command_history[0].end_ms + self.command_history[0].duration_ms) if self.command_history else 0
        baseline = row["baseline_duty"]
        if pd.isna(baseline): baseline = row["heater_duty"]
        if pd.isna(baseline): baseline = row["heater_active"]
        baseline = float(baseline) if pd.notna(baseline) else 0.0
        operating_mode = _mode(row)
        vector = [filtered, target, target - filtered, slope, heat5, heat15, heat30, pump5, pump15, baseline, MODE_CODE[operating_mode]]
        valid = valid_timing and slope_valid and coverage_ms >= 30000 and abs(slope) <= self.config.features.maximum_absolute_slope_c_per_s and all(np.isfinite(value) for value in vector)
        return {"temperature_filtered_c": filtered, "target_temperature_c": target, "temperature_error_c": target - filtered,
                "temperature_slope_c_per_s": slope, "temperature_acceleration_c_per_s2": acceleration,
                "heat_5s": heat5, "heat_15s": heat15, "heat_30s": heat30, "pump_5s": pump5, "pump_15s": pump15,
                "baseline_heater_duty": baseline, "operating_mode_name": operating_mode,
                "operating_mode": MODE_CODE[operating_mode], "feature_valid": valid}


def recreate_features(frame: pd.DataFrame, config: ToolConfig) -> pd.DataFrame:
    sessions: list[pd.DataFrame] = []
    for _, group in frame.groupby("session_id", sort=False):
        state = IncrementalFirmwareFeatures(config); base_time = group["timestamp"].iloc[0]
        rows = [state.update(row, int((row["timestamp"] - base_time).total_seconds() * 1000) if pd.notna(row["timestamp"]) else state.previous_ms) for _, row in group.iterrows()]
        sessions.append(pd.concat([group.reset_index(drop=True), pd.DataFrame(rows)], axis=1))
    return pd.concat(sessions, ignore_index=True)


def align_future_targets(frame: pd.DataFrame, horizons: list[int], tolerance_multiplier: float) -> pd.DataFrame:
    output = frame.copy()
    for horizon in horizons:
        output[f"target_{horizon}s_c"] = np.nan
    for _, group in output.groupby("session_id", sort=False):
        indices = group.index.to_numpy()
        # Do not rely on pandas' internal datetime storage unit (which may be
        # ns or us depending on the pandas release).
        times = group["timestamp"].map(lambda value: value.timestamp()).to_numpy(dtype=float)
        temperatures = group["temperature"].to_numpy(dtype=float)
        positive = np.diff(times); positive = positive[positive > 0]
        interval = float(np.median(positive)) if len(positive) else 1.0
        tolerance = interval * tolerance_multiplier
        for horizon in horizons:
            positions = np.searchsorted(times, times + horizon)
            valid = positions < len(times)
            valid_positions = positions[valid]
            matched = np.abs(times[valid_positions] - (times[valid] + horizon)) <= tolerance
            output.loc[indices[valid][matched], f"target_{horizon}s_c"] = temperatures[valid_positions[matched]]
    return output
