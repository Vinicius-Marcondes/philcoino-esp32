from __future__ import annotations

import pandas as pd
import pytest

from philcoino_thermal.plots import plot_prediction, prediction_plot_copy


@pytest.mark.parametrize("horizon", [5, 10, 20])
def test_prediction_plot_copy_explains_actual_and_predicted_values(horizon):
    copy = prediction_plot_copy(horizon)

    assert copy["actual_axis"] == f"Actual boiler temperature {horizon} seconds later (°C)"
    assert copy["predicted_axis"] == f"Model-predicted boiler temperature {horizon} seconds later (°C)"
    assert "blue dot" in copy["subtitle"]
    assert copy["predictions_label"] == "Model predictions (one dot per sample)"
    assert copy["perfect_label"] == "Perfect prediction (predicted = actual)"


@pytest.mark.parametrize("horizon", [5, 10, 20])
def test_prediction_plot_is_generated_for_each_horizon(tmp_path, horizon):
    pytest.importorskip("matplotlib")
    output = tmp_path / f"prediction_{horizon}s.png"

    plot_prediction(
        pd.Series([89.5, 90.0, 90.5]),
        pd.Series([89.6, 89.9, 90.4]),
        horizon,
        output,
    )

    assert output.exists()
    assert output.stat().st_size > 0
