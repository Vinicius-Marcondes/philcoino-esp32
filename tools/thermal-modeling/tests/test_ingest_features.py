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


def test_split_on_gap_and_uptime_reset(tmp_path, config):
    path = tmp_path / "gaps.csv"
    pd.DataFrame({
        "timestamp": ["2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "2026-01-01T00:01:00Z"],
        "boiler_temperature": [90, 91, 92], "target_temperature": [93, 93, 93],
        "heater_active": [1, 1, 0], "pump_state": [0, 0, 0], "machine_mode": ["brew"] * 3,
        "status": ["heating"] * 3, "fault": [""] * 3, "uptime_ms": [0, 1000, 0],
    }).to_csv(path, index=False)
    assert load_dataset([path], config).frame["session_id"].nunique() == 2


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


def test_target_alignment_never_crosses_sessions(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs[:2], config)
    featured = recreate_features(dataset.frame, config)
    aligned = align_future_targets(featured, [20], 0.6)
    for _, session in aligned.groupby("session_id"):
        assert session.iloc[-1]["target_20s_c"] != session.iloc[-1]["target_20s_c"]


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
