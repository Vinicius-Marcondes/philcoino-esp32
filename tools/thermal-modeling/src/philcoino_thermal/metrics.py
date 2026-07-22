from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    error = predicted - actual
    absolute = np.abs(error)
    return {
        "count": int(len(actual)),
        "mae": float(np.mean(absolute)),
        "rmse": float(np.sqrt(np.mean(error ** 2))),
        "p90_absolute_error": float(np.quantile(absolute, 0.90)),
        "p95_absolute_error": float(np.quantile(absolute, 0.95)),
        "bias": float(np.mean(error)),
    }


def prediction_metrics(frame: pd.DataFrame, horizon: int, predicted: np.ndarray) -> dict[str, Any]:
    actual = frame[f"target_{horizon}s_c"].to_numpy(dtype=float)
    result: dict[str, Any] = regression_metrics(actual, predicted)
    persistence = frame["temperature"].to_numpy(dtype=float)
    linear = persistence + horizon * frame["temperature_slope_c_per_s"].to_numpy(dtype=float)
    result["persistence"] = regression_metrics(actual, persistence)
    result["linear_extrapolation"] = regression_metrics(actual, linear)
    modes: dict[str, Any] = {}
    for mode, subset in frame.assign(_prediction=predicted).groupby("operating_mode_name"):
        modes[str(mode)] = regression_metrics(subset[f"target_{horizon}s_c"].to_numpy(float), subset["_prediction"].to_numpy(float))
    result["by_mode"] = modes
    rising = (frame["temperature"] >= frame["target"] - 5.0) & (frame["temperature_slope_c_per_s"] > 0)
    if rising.any():
        result["near_target_rising"] = regression_metrics(actual[rising.to_numpy()], predicted[rising.to_numpy()])
        result["near_target_rising_persistence"] = regression_metrics(actual[rising.to_numpy()], persistence[rising.to_numpy()])
    else:
        result["near_target_rising"] = None
        result["near_target_rising_persistence"] = None
    return result


def controller_metrics(frame: pd.DataFrame, stable_band_c: float = 0.5) -> dict[str, float]:
    error = frame["temperature"] - frame["target"]
    if "simulated_heater_duty" in frame:
        duty_series = frame["simulated_heater_duty"]
    elif "heater_duty" in frame:
        duty_series = frame["heater_duty"].fillna(frame.get("heater_active", 0))
    else:
        duty_series = frame["heater_active"]
    duty = duty_series.fillna(0).to_numpy(float)
    recovery_times: list[float] = []
    pump = frame.get("pump", pd.Series(0.0, index=frame.index)).fillna(0).to_numpy(float) > 0.5
    pump_off = np.flatnonzero(~pump & np.r_[False, pump[:-1]])
    for start in pump_off:
        stable = np.flatnonzero(error.iloc[start:].abs().to_numpy() <= stable_band_c)
        if len(stable):
            end = start + int(stable[0])
            recovery_times.append((frame["timestamp"].iloc[end] - frame["timestamp"].iloc[start]).total_seconds())
    limits = np.where(frame.get("mode", pd.Series("brew", index=frame.index)).astype(str).eq("steam"), 130.0, 98.0)
    return {
        "peak_overshoot_c": float(max(0.0, error.max())),
        "maximum_undershoot_c": float(max(0.0, -error.min())),
        "mean_absolute_target_error_c": float(error.abs().mean()),
        "fraction_inside_0_5c": float((error.abs() <= stable_band_c).mean()),
        "fraction_inside_1_0c": float((error.abs() <= 1.0).mean()),
        "mean_heater_duty": float(np.mean(duty)),
        "heater_switching_count": int(np.count_nonzero(np.diff(duty > 0.0))),
        "median_recovery_time_seconds": float(np.median(recovery_times)) if recovery_times else 0.0,
        "safety_violation_count": int(np.count_nonzero(frame["temperature"].to_numpy(float) >= limits)),
    }
