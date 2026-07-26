from __future__ import annotations

from dataclasses import dataclass
import platform
from typing import Any

import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

from .config import ToolConfig
from .metrics import regression_metrics
from .predictor import chronological_groups
from .scope import healthy_modeling_segments


PLANT_FEATURES = ["temperature", "temperature_delta_previous", "plant_heater_duty", "heater_mean_5s", "pump", "pump_mean_5s", "operating_mode", "sample_interval_seconds"]


@dataclass
class PlantTrainingResult:
    artifact: dict[str, Any]
    fitted_model: tuple[StandardScaler, Ridge]


def prepare_plant_rows(frame: pd.DataFrame) -> pd.DataFrame:
    data = frame.copy()
    duty = data["heater_duty"].copy()
    duty = duty.fillna(data["heater_active"])
    data["plant_heater_duty"] = duty
    grouped = data.groupby("modeling_segment_id", sort=False)
    data["temperature_delta_previous"] = grouped["temperature"].diff().fillna(0)
    data["heater_mean_5s"] = data["heat_5s"] / 5.0
    data["pump_mean_5s"] = data["pump_5s"] / 5.0
    data["sample_interval_seconds"] = grouped["timestamp"].diff().dt.total_seconds()
    data["sample_interval_seconds"] = data["sample_interval_seconds"].fillna(
        data.groupby("modeling_segment_id")["sample_interval_seconds"].transform("median")
    )
    data["temperature_next"] = grouped["temperature"].shift(-1)
    data["temperature_delta_next"] = data["temperature_next"] - data["temperature"]
    return data.dropna(subset=PLANT_FEATURES + ["temperature_delta_next"])


def _choose_alpha(rows: pd.DataFrame, groups: list[str], config: ToolConfig) -> float:
    if len(groups) < 2:
        return float(config.plant.alpha_values[0])
    best = (float("inf"), float(config.plant.alpha_values[0]))
    for alpha in config.plant.alpha_values:
        errors: list[float] = []
        for index in range(1, len(groups)):
            train = rows[rows["session_id"].isin(groups[:index])]
            validation = rows[rows["session_id"] == groups[index]]
            if train.empty or validation.empty:
                continue
            scaler = StandardScaler().fit(train[PLANT_FEATURES])
            model = Ridge(alpha=alpha).fit(
                scaler.transform(train[PLANT_FEATURES]),
                train["temperature_delta_next"],
            )
            predicted = model.predict(scaler.transform(validation[PLANT_FEATURES]))
            errors.extend(
                np.abs(predicted - validation["temperature_delta_next"].to_numpy(float)).tolist()
            )
        score = float(np.mean(errors)) if errors else float("inf")
        if score < best[0]:
            best = (score, float(alpha))
    return best[1]


def train_plant(frame: pd.DataFrame, dataset_hash: str, config: ToolConfig, source_file_hashes: list[str] | None = None) -> PlantTrainingResult:
    scoped = healthy_modeling_segments(frame, config)
    rows = prepare_plant_rows(scoped)
    groups = chronological_groups(rows)
    if not groups:
        raise ValueError("No valid plant-model rows are available.")
    held_out = len(groups) >= 2
    test_groups = groups[-1:] if held_out else []
    train_groups = groups[:-1] if held_out else groups
    train = rows[rows["session_id"].isin(train_groups)]
    test = rows[rows["session_id"].isin(test_groups)]
    evaluation = test if held_out else train
    alpha = _choose_alpha(train, train_groups, config)
    scaler = StandardScaler().fit(train[PLANT_FEATURES])
    model = Ridge(alpha=alpha).fit(
        scaler.transform(train[PLANT_FEATURES]),
        train["temperature_delta_next"],
    )
    raw_coef = model.coef_ / scaler.scale_
    intercept = float(model.intercept_ - np.dot(raw_coef, scaler.mean_))
    predicted_delta = intercept + evaluation[PLANT_FEATURES].to_numpy(float) @ raw_coef
    predicted_temperature = evaluation["temperature"].to_numpy(float) + predicted_delta
    metrics = regression_metrics(evaluation["temperature_next"].to_numpy(float), predicted_temperature)
    ranges = {name: {"minimum": float(train[name].min()), "maximum": float(train[name].max())} for name in PLANT_FEATURES}
    artifact = {
        "artifact_schema_version": 1, "model_version": 1, "tool_version": "0.1.0",
        "runtime": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "scikit_learn": sklearn.__version__},
        "model_type": "ARX-temperature-delta", "dataset_sha256": dataset_hash,
        "source_file_hashes": source_file_hashes or [],
        "active_modes": sorted(mode.lower() for mode in config.modeling.active_modes),
        "features": PLANT_FEATURES, "intercept": float(np.float32(intercept)),
        "coefficients": [float(np.float32(value)) for value in raw_coef], "alpha": alpha,
        "input_ranges": ranges, "metrics": metrics,
        "training_sessions": train_groups,
        "validation_sessions": train_groups[1:],
        "test_sessions": test_groups,
        "evaluation_type": "held_out" if held_out else "training_only",
        "evaluation_sessions": test_groups if held_out else train_groups,
        "boolean_heater_fallback": bool(scoped["heater_duty"].isna().all()),
    }
    return PlantTrainingResult(artifact=artifact, fitted_model=(scaler, model))


def plant_step(artifact: dict[str, Any], values: dict[str, float]) -> tuple[float, list[str]]:
    vector = np.asarray([values[name] for name in artifact["features"]], dtype=np.float32)
    warnings = []
    for name, value in zip(artifact["features"], vector, strict=True):
        bounds = artifact["input_ranges"][name]
        if value < bounds["minimum"] or value > bounds["maximum"]:
            warnings.append(name)
    delta = np.float32(artifact["intercept"]) + vector @ np.asarray(artifact["coefficients"], dtype=np.float32)
    return float(values["temperature"] + delta), warnings
