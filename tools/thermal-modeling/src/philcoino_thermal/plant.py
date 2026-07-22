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
    grouped = data.groupby("session_id", sort=False)
    data["temperature_delta_previous"] = grouped["temperature"].diff().fillna(0)
    data["heater_mean_5s"] = data["heat_5s"] / 5.0
    data["pump_mean_5s"] = data["pump_5s"] / 5.0
    data["sample_interval_seconds"] = grouped["timestamp"].diff().dt.total_seconds()
    data["sample_interval_seconds"] = data["sample_interval_seconds"].fillna(data.groupby("session_id")["sample_interval_seconds"].transform("median"))
    data["temperature_next"] = grouped["temperature"].shift(-1)
    data["temperature_delta_next"] = data["temperature_next"] - data["temperature"]
    return data.dropna(subset=PLANT_FEATURES + ["temperature_delta_next"])


def train_plant(frame: pd.DataFrame, dataset_hash: str, config: ToolConfig, source_file_hashes: list[str] | None = None) -> PlantTrainingResult:
    rows = prepare_plant_rows(frame[frame["fault"].fillna("").eq("")])
    groups = chronological_groups(rows)
    if not groups:
        raise ValueError("No valid plant-model rows are available.")
    test_group = groups[-1]
    train = rows[rows["session_id"] != test_group]
    test = rows[rows["session_id"] == test_group]
    if train.empty:
        train = rows; test = rows
    best: tuple[float, float, StandardScaler, Ridge] | None = None
    for alpha in config.plant.alpha_values:
        scaler = StandardScaler().fit(train[PLANT_FEATURES])
        model = Ridge(alpha=alpha).fit(scaler.transform(train[PLANT_FEATURES]), train["temperature_delta_next"])
        score = float(np.mean(np.abs(model.predict(scaler.transform(test[PLANT_FEATURES])) - test["temperature_delta_next"])))
        if best is None or score < best[0]: best = (score, float(alpha), scaler, model)
    assert best is not None
    _, alpha, scaler, model = best
    raw_coef = model.coef_ / scaler.scale_
    intercept = float(model.intercept_ - np.dot(raw_coef, scaler.mean_))
    predicted_delta = intercept + test[PLANT_FEATURES].to_numpy(float) @ raw_coef
    predicted_temperature = test["temperature"].to_numpy(float) + predicted_delta
    metrics = regression_metrics(test["temperature_next"].to_numpy(float), predicted_temperature)
    ranges = {name: {"minimum": float(train[name].min()), "maximum": float(train[name].max())} for name in PLANT_FEATURES}
    artifact = {
        "artifact_schema_version": 1, "model_version": 1, "tool_version": "0.1.0",
        "runtime": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "scikit_learn": sklearn.__version__},
        "model_type": "ARX-temperature-delta", "dataset_sha256": dataset_hash,
        "source_file_hashes": source_file_hashes or [],
        "features": PLANT_FEATURES, "intercept": float(np.float32(intercept)),
        "coefficients": [float(np.float32(value)) for value in raw_coef], "alpha": alpha,
        "input_ranges": ranges, "metrics": metrics,
        "training_sessions": [group for group in groups if group != test_group], "test_sessions": [test_group],
        "boolean_heater_fallback": bool(frame["heater_duty"].isna().all()),
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
