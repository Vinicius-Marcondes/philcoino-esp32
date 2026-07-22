from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import ToolConfig
from .controller import FirmwareDutyController, PredictionCorrection, apply_prediction_correction
from .features import FEATURE_ORDER, IncrementalFirmwareFeatures
from .metrics import controller_metrics
from .plant import plant_step
from .predictor import predict_raw


def simulate_session(
    timeline: pd.DataFrame,
    predictor: dict[str, Any],
    plant: dict[str, Any],
    config: ToolConfig,
    correction: PredictionCorrection | None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    source = timeline.sort_values("timestamp").reset_index(drop=True)
    if len(source) < 2:
        raise ValueError("Simulation requires at least two samples.")
    controller = FirmwareDutyController(config.controller)
    temperature = float(source["temperature"].iloc[0])
    previous_temperature = temperature
    heater_history: list[float] = []
    pump_history: list[float] = []
    simulated_rows: list[dict[str, Any]] = []
    feature_state = IncrementalFirmwareFeatures(config)
    extrapolation: set[str] = set()
    started = source["timestamp"].iloc[0]
    for index, historical in source.iterrows():
        target = float(historical["target"])
        mode = str(historical["mode"]).lower()
        operating = str(historical.get("operating_mode_name", "brewing" if historical["pump"] else "warmup"))
        brewing = operating == "brewing"
        baseline = controller.requested_duty(temperature, target, mode, brewing)
        now_s = (historical["timestamp"] - started).total_seconds()
        feature_input = pd.Series({
            "timestamp": historical["timestamp"], "temperature": temperature, "temperature_raw": np.nan,
            "target": target, "pump": float(historical["pump"]), "mode": mode,
            "status": "ready" if abs(temperature - target) <= 1 else "heating", "fault": "",
            "heater_active": heater_history[-1] if heater_history else 0.0, "heater_duty": baseline,
            "baseline_duty": baseline, "session_id": "simulation", "logged_prediction_operating_mode": operating,
        })
        features = pd.Series(feature_state.update(feature_input, int(now_s * 1000)))
        requested = baseline
        predictions: dict[int, float] = {}
        if correction is not None and bool(features["feature_valid"]):
            vector = features[FEATURE_ORDER].to_numpy(np.float32)
            for horizon in correction.horizons:
                predictions[horizon] = float(predict_raw(predictor, horizon, vector.reshape(1, -1))[0])
            requested = apply_prediction_correction(baseline, temperature, target, list(predictions.values()), correction)
        duty_target = target + (config.controller.extraction_duty_offset_c if mode == "brew" and brewing else 0)
        duty_target = min(duty_target, config.controller.brew_over_temperature_c - 1) if mode == "brew" else duty_target
        heater_active = float(controller.command_active(now_s, requested, temperature, duty_target))
        pump = float(historical["pump"])
        heater_history.append(heater_active); pump_history.append(pump)
        simulated_rows.append({
            "timestamp": historical["timestamp"], "temperature": temperature, "target": target,
            "pump": pump, "mode": mode, "operating_mode_name": operating,
            "baseline_heater_duty": baseline, "simulated_requested_duty": requested,
            "simulated_heater_duty": heater_active, "predicted_peak_c": max(predictions.values()) if predictions else np.nan,
        })
        if index == len(source) - 1:
            continue
        plant_values = {
            "temperature": temperature,
            "temperature_delta_previous": temperature - previous_temperature,
            "plant_heater_duty": heater_active,
            "heater_mean_5s": float(np.mean(heater_history[-5:])),
            "pump": pump,
            "pump_mean_5s": float(np.mean(pump_history[-5:])),
            "operating_mode": float(features["operating_mode"]),
            "sample_interval_seconds": float((source["timestamp"].iloc[index + 1] - historical["timestamp"]).total_seconds()),
        }
        next_temperature, outside = plant_step(plant, plant_values)
        extrapolation.update(outside)
        previous_temperature, temperature = temperature, next_temperature
    result = pd.DataFrame(simulated_rows)
    report = controller_metrics(result, config.validation.stable_band_c)
    report["extrapolation_features"] = sorted(extrapolation)
    report["extrapolation_steps_detected"] = bool(extrapolation)
    return result, report


def compare_simulations(frame: pd.DataFrame, predictor: dict[str, Any], plant: dict[str, Any], config: ToolConfig, candidate: PredictionCorrection) -> tuple[pd.DataFrame, dict[str, Any]]:
    comparisons: list[pd.DataFrame] = []
    baseline_metrics: list[dict[str, Any]] = []
    candidate_metrics: list[dict[str, Any]] = []
    for session_id, session in frame.groupby("session_id", sort=False):
        baseline, baseline_report = simulate_session(session, predictor, plant, config, None)
        proposed, proposed_report = simulate_session(session, predictor, plant, config, candidate)
        baseline["configuration"] = "current"; proposed["configuration"] = "candidate"
        baseline["session_id"] = session_id; proposed["session_id"] = session_id
        comparisons.extend([baseline, proposed]); baseline_metrics.append(baseline_report); candidate_metrics.append(proposed_report)
    def aggregate(reports: list[dict[str, Any]]) -> dict[str, Any]:
        numeric = [key for key, value in reports[0].items() if isinstance(value, (int, float)) and not isinstance(value, bool)]
        merged = {key: float(np.median([report[key] for report in reports])) for key in numeric}
        merged["extrapolation_features"] = sorted({value for report in reports for value in report["extrapolation_features"]})
        merged["extrapolation_steps_detected"] = bool(merged["extrapolation_features"])
        return merged
    return pd.concat(comparisons, ignore_index=True), {"current": aggregate(baseline_metrics), "candidate": aggregate(candidate_metrics)}
