from __future__ import annotations

import pandas as pd
import pytest

from philcoino_thermal.features import FEATURE_ORDER, align_future_targets, recreate_features
from philcoino_thermal.ingest import load_dataset
from philcoino_thermal.segmentation import extract_events, segment_operating_state


def test_ingests_aliases_accepts_missing_scale_and_warns_on_boolean_duty(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs, config)
    assert dataset.quality["sessions"] == 3
    assert dataset.quality["faulted_rows"] == 0
    assert all(not item["scale_columns_available"] for item in dataset.files)
    assert all(item["boolean_heater_fallback"] for item in dataset.files)
    assert dataset.quality["warnings"]


def test_minimum_current_export_and_legacy_prediction_columns_are_non_authoritative(
    tmp_path,
    config,
):
    path = tmp_path / "current-and-legacy.csv"
    rows = 40
    frame = pd.DataFrame({
        "recorded_at_utc": pd.date_range(
            "2026-01-01T00:00:00Z",
            periods=rows,
            freq="1s",
        ),
        "boiler_temperature_c": [89 + 0.1 * index for index in range(rows)],
        "active_target_c": [93] * rows,
        "heater_active": [1] * 20 + [0] * 20,
        "pump_active": [0] * rows,
        "active_mode": ["brew"] * rows,
        "machine_status": ["heating"] * rows,
        "fault_code": [""] * rows,
        # Retained historical columns are accepted but cannot silently own
        # current modeling features.
        "temperature_filtered_c": [120] * rows,
        "temperature_slope_c_per_s": [9] * rows,
        "heat_5s": [5] * rows,
        "heat_15s": [15] * rows,
        "heat_30s": [30] * rows,
        "pump_5s": [0] * rows,
        "pump_15s": [0] * rows,
        "baseline_heater_duty": [1] * rows,
        "prediction_operating_mode": ["brewing"] * rows,
        "prediction_usable": [True] * rows,
        "prediction_feature_schema_version": [1] * rows,
    })
    frame.to_csv(path, index=False)

    dataset = load_dataset([path], config)
    default_features = recreate_features(dataset.frame, config)
    legacy_opt_in = recreate_features(
        dataset.frame,
        config,
        prefer_logged=True,
    )

    assert len(dataset.frame) == rows
    assert set(default_features["feature_source"]) == {"reconstructed"}
    assert legacy_opt_in.iloc[-1]["feature_source"] == "logged_firmware"
    assert default_features.iloc[-1]["temperature_filtered_c"] != 120


def test_split_on_timestamp_gap_and_large_uptime_reset(tmp_path, config):
    path = tmp_path / "gaps.csv"
    pd.DataFrame({
        "timestamp": [
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z",
            "2026-01-01T00:01:00Z", "2026-01-01T00:01:01Z",
            "2026-01-01T00:01:02Z",
        ],
        "boiler_temperature": [90, 91, 92, 92.5, 93], "target_temperature": [93] * 5,
        "heater_active": [1, 1, 0, 0, 0], "pump_state": [0] * 5, "machine_mode": ["brew"] * 5,
        "status": ["heating"] * 5, "fault": [""] * 5,
        "uptime_ms": [100_000, 101_000, 160_000, 161_000, 100],
    }).to_csv(path, index=False)
    one_hertz = config.model_copy(update={
        "sampling": config.sampling.model_copy(update={"expected_interval_seconds": 1.0})
    })
    dataset = load_dataset([path], one_hertz)
    assert dataset.frame["session_id"].nunique() == 3
    assert dataset.quality["session_boundary_counts"] == {
        "file_start": 1,
        "timestamp_gap": 1,
        "uptime_reset": 1,
    }


def test_small_uptime_backsteps_are_reported_as_jitter_without_splitting(tmp_path, config):
    path = tmp_path / "uptime-jitter.csv"
    pd.DataFrame({
        "timestamp": pd.date_range("2026-01-01T00:00:00Z", periods=6, freq="1s"),
        "boiler_temperature": [90, 90.25, 90.5, 90.75, 91, 91.25],
        "target_temperature": [93] * 6,
        "heater_active": [1] * 6,
        "pump_state": [0] * 6,
        "machine_mode": ["brew"] * 6,
        "status": ["heating"] * 6,
        "fault": [""] * 6,
        "uptime_ms": [100_000, 101_000, 100_900, 102_000, 101_000, 103_000],
    }).to_csv(path, index=False)

    dataset = load_dataset([path], config)

    assert dataset.frame["session_id"].nunique() == 1
    assert dataset.quality["ignored_uptime_backsteps"] == 2
    assert dataset.quality["largest_ignored_uptime_backstep_ms"] == 1000
    assert dataset.quality["session_boundary_counts"] == {"file_start": 1}
    assert "timing jitter" in dataset.quality["warnings"][-1]
    expanded = pd.concat(
        [
            pd.read_csv(path),
            pd.DataFrame({
                "timestamp": pd.date_range("2026-01-01T00:00:06Z", periods=35, freq="1s"),
                "boiler_temperature": [91.25 + 0.02 * index for index in range(35)],
                "target_temperature": [93] * 35,
                "heater_active": [0] * 35,
                "pump_state": [0] * 35,
                "machine_mode": ["brew"] * 35,
                "status": ["heating"] * 35,
                "fault": [""] * 35,
                "uptime_ms": [104_000 + 1000 * index for index in range(35)],
            }),
        ],
        ignore_index=True,
    )
    expanded.to_csv(path, index=False)
    mature = recreate_features(load_dataset([path], config).frame, config)
    assert mature.iloc[-1]["feature_valid"]


def test_missing_uptime_uses_timestamp_boundaries_only(tmp_path, config):
    path = tmp_path / "timestamp-only.csv"
    pd.DataFrame({
        "timestamp": [
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z",
            "2026-01-01T03:00:00Z",
        ],
        "boiler_temperature": [90, 91, 92],
        "target_temperature": [93] * 3,
        "heater_active": [1, 1, 0],
        "pump_state": [0] * 3,
        "machine_mode": ["brew"] * 3,
        "status": ["heating"] * 3,
        "fault": [""] * 3,
    }).to_csv(path, index=False)

    one_hertz = config.model_copy(update={
        "sampling": config.sampling.model_copy(update={"expected_interval_seconds": 1.0})
    })
    dataset = load_dataset([path], one_hertz)

    assert dataset.frame["session_id"].nunique() == 2
    assert dataset.quality["session_boundary_counts"]["timestamp_gap"] == 1


def test_missing_and_duplicate_timestamps_create_explicit_boundaries(tmp_path, config):
    path = tmp_path / "invalid-timestamps.csv"
    pd.DataFrame({
        "timestamp": [
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:01Z",
            "2026-01-01T00:00:01Z",
            "",
        ],
        "boiler_temperature": [90, 90.25, 90.5, 90.75],
        "target_temperature": [93] * 4,
        "heater_active": [1] * 4,
        "pump_state": [0] * 4,
        "machine_mode": ["brew"] * 4,
        "status": ["heating"] * 4,
        "fault": [""] * 4,
        "uptime_ms": [0, 1000, 1001, 2000],
    }).to_csv(path, index=False)

    dataset = load_dataset([path], config)

    assert dataset.quality["session_boundary_counts"] == {
        "file_start": 1,
        "non_increasing_timestamp": 1,
        "missing_timestamp": 1,
    }
    assert dataset.frame["session_id"].nunique() == 3


def test_firmware_history_features_are_causal_and_mature(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:1], config)
    featured = recreate_features(dataset.frame, config)
    mature = featured.iloc[-1]
    assert mature["feature_valid"]
    assert mature["heat_5s"] == pytest.approx(0.0)
    assert mature["heat_15s"] == pytest.approx(9.0)
    assert mature["heat_30s"] == pytest.approx(24.0)
    assert mature["temperature_slope_c_per_s"] == pytest.approx(0.1, abs=0.01)
    changed = dataset.frame.copy()
    changed.loc[changed.index[-1], "temperature"] = 120
    changed_features = recreate_features(changed, config)
    pd.testing.assert_series_equal(featured.loc[featured.index[-2], FEATURE_ORDER], changed_features.loc[changed_features.index[-2], FEATURE_ORDER])


def test_fault_transition_resets_feature_history(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:1], config)
    changed = dataset.frame.copy()
    changed.loc[changed.index[20], "fault"] = "over_temperature"

    featured = recreate_features(changed, config)

    assert not featured.loc[20, "feature_valid"]
    assert not featured.loc[21, "feature_valid"]
    assert featured.iloc[-1]["feature_valid"]


def test_usable_schema_matching_firmware_features_take_precedence(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:1], config)
    frame = dataset.frame.copy()
    index = frame.index[0]
    frame["logged_prediction_operating_mode"] = frame["logged_prediction_operating_mode"].astype("object")
    frame["logged_prediction_usable"] = frame["logged_prediction_usable"].astype("object")
    frame.loc[index, "temperature_filtered"] = 91.5
    frame.loc[index, "baseline_duty"] = 0.25
    frame.loc[index, "logged_temperature_slope_c_per_s"] = 0.1
    frame.loc[index, "logged_heat_5s"] = 1.0
    frame.loc[index, "logged_heat_15s"] = 2.0
    frame.loc[index, "logged_heat_30s"] = 3.0
    frame.loc[index, "logged_pump_5s"] = 0.5
    frame.loc[index, "logged_pump_15s"] = 0.5
    frame.loc[index, "logged_prediction_operating_mode"] = "brewing"
    frame.loc[index, "logged_prediction_usable"] = True
    frame.loc[index, "logged_prediction_feature_schema_version"] = 1

    reconstructed = recreate_features(frame, config, prefer_logged=False)
    preferred = recreate_features(frame, config, prefer_logged=True)

    assert not reconstructed.loc[index, "feature_valid"]
    assert preferred.loc[index, "feature_valid"]
    assert preferred.loc[index, "feature_source"] == "logged_firmware"
    assert preferred.loc[index, "temperature_filtered_c"] == 91.5
    assert preferred.loc[index, "temperature_error_c"] == pytest.approx(
        preferred.loc[index, "target"] - 91.5
    )
    assert preferred.loc[index, "operating_mode_name"] == "brewing"
    frame.loc[index, "logged_prediction_feature_schema_version"] = 999
    mismatched = recreate_features(frame, config, prefer_logged=True)
    assert mismatched.loc[index, "feature_source"] == "reconstructed"
    assert not mismatched.loc[index, "feature_valid"]


def test_target_alignment_never_crosses_sessions(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:2], config)
    featured = recreate_features(dataset.frame, config)
    aligned = align_future_targets(featured, [20], 0.6)
    for _, session in aligned.groupby("session_id"):
        assert session.iloc[-1]["target_20s_c"] != session.iloc[-1]["target_20s_c"]


def test_target_alignment_never_crosses_active_mode_or_target_change(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:1], config)
    featured = recreate_features(dataset.frame, config)
    changed = featured.copy()
    split = changed.index[len(changed) // 2]
    changed.loc[split:, "mode"] = "steam"
    changed.loc[split:, "target"] = 120

    aligned = align_future_targets(changed, [20], 0.6)

    assert aligned.loc[split - 19:split - 1, "target_20s_c"].isna().all()


def test_target_alignment_never_crosses_fault_transition(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:1], config)
    featured = recreate_features(dataset.frame, config)
    fault_index = featured.index[len(featured) // 2]
    featured.loc[fault_index, "fault"] = "over_temperature"

    aligned = align_future_targets(featured, [20], 0.6)

    assert aligned.loc[fault_index - 19:fault_index, "target_20s_c"].isna().all()


def test_brew_and_recovery_events_are_extracted(synthetic_csvs, config):
    frame = recreate_features(load_dataset(synthetic_csvs[:1], config).frame, config)
    segmented = segment_operating_state(frame, config)
    events = extract_events(segmented, config)
    assert "BREWING" in set(segmented["segment"])
    assert "POST_BREW_RECOVERY" in set(segmented["segment"])
    brewing = events[events["event_type"] == "BREWING"]
    assert len(brewing) == 1
    assert brewing.iloc[0]["duration_seconds"] == 4
    assert {"WARMUP", "POST_BREW_RECOVERY"} <= set(events["event_type"])
