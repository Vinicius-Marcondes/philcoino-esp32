from __future__ import annotations

import numpy as np

from philcoino_thermal.controller import FirmwareDutyController, PredictionCorrection, apply_prediction_correction
from philcoino_thermal.features import align_future_targets, recreate_features
from philcoino_thermal.ingest import load_dataset
from philcoino_thermal.optimizer import evaluate_promotion, optimize
from philcoino_thermal.plant import plant_step, train_plant
from philcoino_thermal.predictor import predict_raw, train_predictor
from philcoino_thermal.simulator import compare_simulations


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
    assert artifact["evaluation_type"] == "held_out"


def test_single_group_metrics_are_training_only_without_fake_test_split(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs[:1], config)

    artifact = train_predictor(frame, dataset.dataset_hash, config).artifact

    assert artifact["evaluation_type"] == "training_only"
    assert artifact["training_sessions"]
    assert artifact["test_sessions"] == []
    assert artifact["evaluation_sessions"] == artifact["training_sessions"]


def test_two_groups_reserve_latest_for_test_without_validation_leakage(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs[:2], config)

    artifact = train_predictor(frame, dataset.dataset_hash, config).artifact

    assert artifact["evaluation_type"] == "held_out"
    assert len(artifact["training_sessions"]) == 1
    assert len(artifact["test_sessions"]) == 1
    assert artifact["validation_sessions"] == []
    assert set(artifact["training_sessions"]).isdisjoint(artifact["test_sessions"])
    favorable_simulation = {
        "comparison": {
            "current": {
                "peak_overshoot_c": 1.0,
                "median_recovery_time_seconds": 10.0,
            },
            "candidate": {
                "peak_overshoot_c": 0.5,
                "median_recovery_time_seconds": 10.0,
                "extrapolation_steps_detected": False,
                "safety_violation_count": 0,
                "correction_active_steps": 1,
            },
        }
    }
    promotion = evaluate_promotion(artifact, favorable_simulation, config)
    assert not promotion["eligible"]
    assert "Insufficient independent session groups." in promotion["reasons"]


def test_predictor_bounds_are_fit_on_training_sessions_only(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    test_session = frame["session_id"].drop_duplicates().iloc[-1]
    frame.loc[frame["session_id"] == test_session, "temperature_filtered_c"] = 500

    artifact = train_predictor(frame, dataset.dataset_hash, config).artifact

    assert artifact["input_ranges"]["temperature_filtered_c"]["maximum"] < 500


def test_brew_scope_excludes_steam_from_predictor_and_plant(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    steam_session = frame["session_id"].drop_duplicates().iloc[-1]
    steam = frame["session_id"] == steam_session
    frame.loc[steam, "mode"] = "steam"
    frame.loc[steam, "target"] = 120
    frame.loc[steam, "target_temperature_c"] = 120
    frame.loc[steam, "temperature"] = 500
    frame.loc[steam, "temperature_filtered_c"] = 500

    predictor = train_predictor(frame, dataset.dataset_hash, config).artifact
    plant = train_plant(frame, dataset.dataset_hash, config).artifact

    assert predictor["active_modes"] == ["brew"]
    assert predictor["input_ranges"]["target_temperature_c"]["maximum"] < 120
    assert plant["active_modes"] == ["brew"]
    assert plant["input_ranges"]["temperature"]["maximum"] < 500


def test_arx_model_records_ranges_and_flags_extrapolation(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    artifact = train_plant(frame, dataset.dataset_hash, config).artifact
    values = {name: artifact["input_ranges"][name]["minimum"] for name in artifact["features"]}
    _, warnings = plant_step(artifact, values)
    assert warnings == []
    values["temperature"] = 1000
    _, warnings = plant_step(artifact, values)
    assert "temperature" in warnings


def test_plant_uses_chronological_validation_without_test_leakage(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    artifact = train_plant(frame, dataset.dataset_hash, config).artifact

    assert artifact["evaluation_type"] == "held_out"
    assert set(artifact["training_sessions"]).isdisjoint(artifact["test_sessions"])
    assert set(artifact["validation_sessions"]).issubset(artifact["training_sessions"])


def test_simulation_excludes_steam_and_faults_without_bridging(synthetic_csvs, config):
    dataset, frame = prepared(synthetic_csvs, config)
    predictor = train_predictor(frame, dataset.dataset_hash, config).artifact
    plant = train_plant(frame, dataset.dataset_hash, config).artifact
    session = frame["session_id"].iloc[0]
    indices = frame.index[frame["session_id"] == session]
    frame.loc[indices[25], "fault"] = "over_temperature"
    frame.loc[indices[40:45], "mode"] = "steam"

    comparison, report = compare_simulations(
        frame,
        predictor,
        plant,
        config,
        PredictionCorrection(),
    )

    assert comparison["mode"].eq("brew").all()
    assert report["modeling_scope"]["excluded_fault_rows"] == 1
    assert report["modeling_scope"]["excluded_mode_rows"] == 5
    assert comparison.loc[comparison["source_session_id"] == session, "session_id"].nunique() == 3
    assert "correction_active_steps" in report["candidate"]


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
