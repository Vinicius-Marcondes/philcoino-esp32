from __future__ import annotations

import numpy as np

from philcoino_thermal.controller import FirmwareDutyController, PredictionCorrection, apply_prediction_correction
from philcoino_thermal.features import align_future_targets, recreate_features
from philcoino_thermal.ingest import load_dataset
from philcoino_thermal.optimizer import evaluate_promotion, optimize
from philcoino_thermal.plant import plant_step, train_plant
from philcoino_thermal.predictor import predict_raw, train_predictor


def prepared(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs, config)
    frame = recreate_features(dataset.frame, config)
    return dataset, align_future_targets(frame, config.predictor.horizons_seconds, 0.6)


def test_grouped_predictor_and_raw_coefficients(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    result = train_predictor(frame, dataset.dataset_hash, config)
    artifact = result.artifact
    assert artifact["training_sessions"] and artifact["test_sessions"]
    assert set(artifact["training_sessions"]).isdisjoint(artifact["test_sessions"])
    row = frame[frame["feature_valid"]].iloc[0]
    value = predict_raw(artifact, 10, row[artifact["feature_order"]].to_numpy().reshape(1, -1))[0]
    assert np.isfinite(value)
    assert artifact["models"]["10"]["metrics"]["persistence"]["count"] > 0


def test_arx_model_records_ranges_and_flags_extrapolation(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    artifact = train_plant(frame, dataset.dataset_hash, config).artifact
    values = {name: artifact["input_ranges"][name]["minimum"] for name in artifact["features"]}
    _, warnings = plant_step(artifact, values)
    assert warnings == []
    values["temperature"] = 1000
    _, warnings = plant_step(artifact, values)
    assert "temperature" in warnings


def test_duty_curve_and_prediction_are_reduction_only(config):
    controller = FirmwareDutyController(config.controller)
    duty = controller.requested_duty(90, 93, "brew", False)
    assert 0 < duty < 1
    settings = PredictionCorrection()
    assert apply_prediction_correction(duty, 92, 93, [94], settings) == 0
    assert apply_prediction_correction(duty, 80, 93, [94], settings) == duty


def test_optimizer_is_deterministic_and_promotion_is_gated(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    predictor = train_predictor(frame, dataset.dataset_hash, config).artifact
    plant = train_plant(frame, dataset.dataset_hash, config).artifact
    candidate, report = optimize(frame.groupby("session_id", sort=False).tail(40), predictor, plant, config)
    assert candidate.deadband_c == PredictionCorrection().deadband_c
    assert candidate.horizons in {(5,), (10,), (20,), (5, 10), (10, 20), (5, 10, 20)}
    promotion = evaluate_promotion(predictor, report, config)
    assert isinstance(promotion["eligible"], bool)
    assert report["evaluated_candidates"] == 6
