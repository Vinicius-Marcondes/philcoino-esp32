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
from .features import FEATURE_ORDER
from .metrics import prediction_metrics


@dataclass
class PredictorTrainingResult:
    artifact: dict[str, Any]
    fitted_models: dict[int, tuple[StandardScaler, Ridge]]


def chronological_groups(frame: pd.DataFrame) -> list[str]:
    starts = frame.groupby("session_id")["timestamp"].min().sort_values()
    return [str(value) for value in starts.index]


def _raw_coefficients(scaler: StandardScaler, model: Ridge) -> tuple[float, list[float]]:
    coefficients = model.coef_ / scaler.scale_
    intercept = float(model.intercept_ - np.dot(coefficients, scaler.mean_))
    return float(np.float32(intercept)), [float(np.float32(value)) for value in coefficients]


def _choose_alpha(frame: pd.DataFrame, groups: list[str], target: str, config: ToolConfig) -> float:
    if len(groups) < 2:
        return float(config.predictor.alpha_values[0])
    best = (float("inf"), float(config.predictor.alpha_values[0]))
    for alpha in config.predictor.alpha_values:
        errors: list[float] = []
        for index in range(1, len(groups)):
            train = frame[frame["session_id"].isin(groups[:index])]
            validation = frame[frame["session_id"] == groups[index]]
            if train.empty or validation.empty:
                continue
            scaler = StandardScaler().fit(train[FEATURE_ORDER])
            model = Ridge(alpha=alpha).fit(scaler.transform(train[FEATURE_ORDER]), train[target])
            errors.extend(np.abs(model.predict(scaler.transform(validation[FEATURE_ORDER])) - validation[target]).tolist())
        score = float(np.mean(errors)) if errors else float("inf")
        if score < best[0]:
            best = (score, float(alpha))
    return best[1]


def train_predictor(frame: pd.DataFrame, dataset_hash: str, config: ToolConfig, source_file_hashes: list[str] | None = None) -> PredictorTrainingResult:
    usable = frame[frame["feature_valid"] & frame["fault"].fillna("").eq("")].copy()
    complete = usable.dropna(subset=[f"target_{horizon}s_c" for horizon in config.predictor.horizons_seconds])
    groups = chronological_groups(complete)
    if not groups:
        raise ValueError("No rows have mature, valid firmware features.")
    test_groups = groups[-1:]
    train_groups = groups[:-1] or groups
    models: dict[str, Any] = {}
    fitted: dict[int, tuple[StandardScaler, Ridge]] = {}
    all_metrics: dict[str, Any] = {}
    for horizon in config.predictor.horizons_seconds:
        target = f"target_{horizon}s_c"
        horizon_rows = usable.dropna(subset=[target])
        train = horizon_rows[horizon_rows["session_id"].isin(train_groups)]
        test = horizon_rows[horizon_rows["session_id"].isin(test_groups)]
        if train.empty:
            raise ValueError(f"No training rows available for {horizon}-second horizon.")
        alpha = _choose_alpha(train, train_groups, target, config)
        scaler = StandardScaler().fit(train[FEATURE_ORDER])
        model = Ridge(alpha=alpha).fit(scaler.transform(train[FEATURE_ORDER]), train[target])
        intercept, coefficients = _raw_coefficients(scaler, model)
        evaluation = test if not test.empty else train
        predicted = np.float32(intercept) + evaluation[FEATURE_ORDER].to_numpy(np.float32) @ np.asarray(coefficients, dtype=np.float32)
        metrics = prediction_metrics(evaluation, horizon, predicted.astype(float))
        models[str(horizon)] = {"alpha": alpha, "intercept": intercept, "coefficients": coefficients, "metrics": metrics}
        fitted[horizon] = (scaler, model)
        all_metrics[str(horizon)] = metrics
    bounds = {
        name: {"minimum": float(usable[name].min()), "maximum": float(usable[name].max())}
        for name in FEATURE_ORDER
    }
    artifact = {
        "artifact_schema_version": 1,
        "tool_version": "0.1.0",
        "runtime": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "scikit_learn": sklearn.__version__},
        "model_version": 1,
        "feature_schema_version": config.features.schema_version,
        "feature_order": FEATURE_ORDER,
        "horizons_seconds": config.predictor.horizons_seconds,
        "dataset_sha256": dataset_hash,
        "source_file_hashes": source_file_hashes or [],
        "training_data_hash": int(dataset_hash[:8], 16),
        "training_sessions": train_groups,
        "test_sessions": test_groups,
        "input_ranges": bounds,
        "models": models,
        "metrics": all_metrics,
        "promotion": {"eligible": False, "reasons": ["Simulation and promotion evaluation have not run."]},
    }
    return PredictorTrainingResult(artifact=artifact, fitted_models=fitted)


def predict_raw(artifact: dict[str, Any], horizon: int, features: np.ndarray) -> np.ndarray:
    model = artifact["models"][str(horizon)]
    return np.float32(model["intercept"]) + np.asarray(features, dtype=np.float32) @ np.asarray(model["coefficients"], dtype=np.float32)
