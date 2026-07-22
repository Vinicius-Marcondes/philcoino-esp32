from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import yaml

from philcoino_thermal import workflow
from philcoino_thermal.artifacts import canonicalize_predictor, export_firmware, render_firmware_header, write_json
from philcoino_thermal.cli import main
from philcoino_thermal.features import align_future_targets, recreate_features
from philcoino_thermal.ingest import load_dataset
from philcoino_thermal.predictor import predict_raw, train_predictor


def promotable_artifact(synthetic_csvs, config):
    dataset = load_dataset(synthetic_csvs, config)
    frame = align_future_targets(recreate_features(dataset.frame, config), [5, 10, 20], 0.6)
    artifact = train_predictor(frame, dataset.dataset_hash, config).artifact
    artifact["promotion"] = {"eligible": True, "reasons": []}
    artifact["controller"] = {
        "prediction_deadband_c": 0.2, "prediction_gain_per_c": 0.25,
        "hard_cutoff_margin_c": 0.3, "activation_band_c": 8.0,
        "horizons": [5, 10, 20],
    }
    return canonicalize_predictor(artifact, created_at="2026-07-21T00:00:00Z"), frame


def test_export_is_deterministic_and_blocked_when_unpromoted(synthetic_csvs, config, tmp_path):
    artifact, _ = promotable_artifact(synthetic_csvs, config)
    assert render_firmware_header(artifact, config) == render_firmware_header(artifact, config)
    blocked = dict(artifact); blocked["promotion"] = {"eligible": False, "reasons": ["test"]}
    with pytest.raises(ValueError, match="blocked"):
        export_firmware(blocked, tmp_path / "blocked.h", config)


def test_generated_coefficients_match_independent_cpp(synthetic_csvs, config, tmp_path):
    compiler = shutil.which("c++")
    if compiler is None:
        pytest.skip("C++ compiler unavailable")
    artifact, frame = promotable_artifact(synthetic_csvs, config)
    header = export_firmware(artifact, tmp_path / "temp_prediction_model.h", config)
    row = frame[frame["feature_valid"]].iloc[0]
    vector = row[artifact["feature_order"]].to_numpy(np.float32)
    expected = float(predict_raw(artifact, 10, vector.reshape(1, -1))[0])
    def cpp_float(value):
        rendered = f"{float(value):.9g}"
        if "." not in rendered and "e" not in rendered.lower(): rendered += ".0"
        return rendered + "F"
    values = ", ".join(cpp_float(value) for value in vector)
    source = tmp_path / "parity.cpp"
    source.write_text(
        '#include <array>\n#include <iomanip>\n#include <iostream>\n#include "temp_prediction_model.h"\n'
        'int main() { std::array<float, philcoino::config::kTemperaturePredictionFeatureCount> x{{' + values + '}}; '
        'float y = philcoino::config::kGeneratedTemperaturePredictionConfig.horizon_10s.intercept; '
        'for (std::size_t i = 0; i < x.size(); ++i) y += x[i] * philcoino::config::kGeneratedTemperaturePredictionConfig.horizon_10s.coefficients[i]; '
        'std::cout << std::setprecision(9) << y; }\n', encoding="utf-8")
    binary = tmp_path / "parity"
    firmware_include = Path(__file__).resolve().parents[3] / "firmware" / "espresso-machine" / "components" / "firmware_config" / "include"
    subprocess.run([compiler, "-std=c++17", f"-I{tmp_path}", f"-I{firmware_include}", str(source), "-o", str(binary)], check=True)
    actual = float(subprocess.check_output([str(binary)], text=True))
    assert actual == pytest.approx(expected, abs=1e-4)


def test_all_cli_commands_and_weekly_safe_workflow(synthetic_csvs, config, tmp_path, monkeypatch):
    monkeypatch.setattr(workflow, "plot_timeline", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_prediction", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_residuals", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_coefficients", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_events", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_overshoot_distribution", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_simulation", lambda *args, **kwargs: None)
    monkeypatch.setattr(workflow, "plot_heater_comparison", lambda *args, **kwargs: None)
    config_path = tmp_path / "config.yaml"
    config_path.write_text(yaml.safe_dump(config.model_dump(), sort_keys=False), encoding="utf-8")
    inputs = [str(path) for path in synthetic_csvs]
    def run(command):
        assert main(command + ["--config", str(config_path)]) == 0
    run(["validate", *inputs, "--output", str(tmp_path / "validate")])
    run(["analyze", *inputs, "--output", str(tmp_path / "analyze")])
    run(["train-predictor", *inputs, "--output", str(tmp_path / "predictor")])
    run(["train-plant", *inputs, "--output", str(tmp_path / "plant")])
    predictor_path = tmp_path / "predictor" / "temp_prediction_model.json"
    plant_path = tmp_path / "plant" / "thermal_plant_model.json"
    run(["simulate", *inputs, "--predictor", str(predictor_path), "--plant", str(plant_path), "--output", str(tmp_path / "simulate")])
    run(["optimize", *inputs, "--predictor", str(predictor_path), "--plant", str(plant_path), "--output", str(tmp_path / "optimize")])
    artifact, _ = promotable_artifact(synthetic_csvs, config)
    eligible_path = tmp_path / "eligible.json"; write_json(eligible_path, artifact)
    run(["export-firmware", str(eligible_path), "--output", str(tmp_path / "export" / "temp_prediction_model.h")])
    run(["weekly-run", *inputs, "--output", str(tmp_path / "weekly")])
    assert (tmp_path / "weekly" / "model_report.md").exists()
    assert (tmp_path / "weekly" / "rejected_candidate" / "temp_prediction_model.json").exists()
    assert not (tmp_path / "weekly" / "exports" / "temp_prediction_model.h").exists()
