from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from philcoino_thermal.config import load_config  # noqa: E402


@pytest.fixture
def config():
    value = load_config()
    return value.model_copy(update={
        "controller": value.controller.model_copy(update={
            "prediction_deadband_values": [0.2], "prediction_gain_values": [0.25],
            "hard_cutoff_margin_values": [0.3], "activation_band_values": [8.0],
        })
    })


@pytest.fixture
def synthetic_csvs(tmp_path: Path) -> list[Path]:
    fixture = pd.read_csv(ROOT / "tests" / "fixtures" / "golden_history.csv")
    outputs = []
    for index in range(3):
        frame = fixture.copy()
        timestamps = pd.to_datetime(frame["recorded_at_utc"], utc=True) + pd.Timedelta(days=index)
        frame["recorded_at_utc"] = timestamps.dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        frame["boiler_temperature_c"] += 0.05 * index
        path = tmp_path / f"session-{index + 1}.csv"
        frame.to_csv(path, index=False)
        outputs.append(path)
    return outputs
