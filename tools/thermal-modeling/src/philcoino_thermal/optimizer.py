from __future__ import annotations

import itertools
from typing import Any

from .config import ToolConfig
from .controller import PredictionCorrection
from .simulator import compare_simulations


def _cost(metrics: dict[str, Any]) -> float:
    if metrics["extrapolation_steps_detected"] or metrics.get("safety_violation_count", 0) > 0:
        return 1_000_000.0
    return (
        5.0 * metrics["peak_overshoot_c"] + 2.0 * metrics["maximum_undershoot_c"]
        + metrics["mean_absolute_target_error_c"] + 0.1 * metrics["heater_switching_count"]
    )


def optimize(frame, predictor: dict[str, Any], plant: dict[str, Any], config: ToolConfig) -> tuple[PredictionCorrection, dict[str, Any]]:
    horizon_options = [(5,), (10,), (20,), (5, 10), (10, 20), (5, 10, 20)]
    available = set(predictor["horizons_seconds"])
    horizon_options = [item for item in horizon_options if set(item) <= available]
    best: tuple[float, PredictionCorrection, dict[str, Any]] | None = None
    evaluated = 0
    for deadband, gain, cutoff, activation, horizons in itertools.product(
        config.controller.prediction_deadband_values,
        config.controller.prediction_gain_values,
        config.controller.hard_cutoff_margin_values,
        config.controller.activation_band_values,
        horizon_options,
    ):
        candidate = PredictionCorrection(deadband, gain, cutoff, activation, horizons)
        _, comparison = compare_simulations(frame, predictor, plant, config, candidate)
        score = _cost(comparison["candidate"]); evaluated += 1
        if best is None or score < best[0]: best = (score, candidate, comparison)
    if best is None:
        raise ValueError("The optimization grid is empty.")
    score, candidate, comparison = best
    return candidate, {"objective": score, "evaluated_candidates": evaluated, "comparison": comparison}


def evaluate_promotion(predictor: dict[str, Any], optimization: dict[str, Any], config: ToolConfig) -> dict[str, Any]:
    reasons: list[str] = []
    groups = len(set(predictor["training_sessions"] + predictor["test_sessions"]))
    if groups < config.validation.minimum_groups_for_promotion:
        reasons.append("Insufficient independent session groups.")
    ten = predictor["metrics"].get("10")
    if ten:
        improvement = 1.0 - ten["mae"] / max(ten["persistence"]["mae"], 1e-9)
        if improvement < config.validation.minimum_10s_mae_improvement:
            reasons.append("10-second MAE improvement is below threshold.")
        rising = ten.get("near_target_rising")
        rising_base = ten.get("near_target_rising_persistence")
        if not rising or not rising_base or 1.0 - rising["mae"] / max(rising_base["mae"], 1e-9) < config.validation.minimum_rising_mae_improvement:
            reasons.append("Near-target rising-temperature improvement is below threshold.")
        if ten["bias"] < -config.validation.maximum_negative_bias_c:
            reasons.append("Prediction has excessive negative bias.")
    current = optimization["comparison"]["current"]
    candidate = optimization["comparison"]["candidate"]
    overshoot_improvement = 1.0 - candidate["peak_overshoot_c"] / max(current["peak_overshoot_c"], 1e-9)
    if overshoot_improvement < config.validation.minimum_overshoot_improvement:
        reasons.append("Simulated overshoot improvement is below threshold.")
    if candidate["extrapolation_steps_detected"]:
        reasons.append("Candidate simulation leaves plant training ranges.")
    if candidate.get("safety_violation_count", 0) > 0:
        reasons.append("Candidate simulation crosses a firmware over-temperature limit.")
    current_recovery = current.get("median_recovery_time_seconds", 0.0)
    candidate_recovery = candidate.get("median_recovery_time_seconds", 0.0)
    if current_recovery > 0 and candidate_recovery > current_recovery * (1.0 + config.validation.maximum_recovery_time_increase):
        reasons.append("Simulated recovery-time increase exceeds threshold.")
    return {"eligible": not reasons, "reasons": reasons}
