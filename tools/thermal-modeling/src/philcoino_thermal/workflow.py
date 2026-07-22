from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from .artifacts import canonicalize_predictor, export_firmware, read_json, write_json
from .config import ToolConfig
from .controller import PredictionCorrection
from .features import FEATURE_ORDER, align_future_targets, recreate_features
from .ingest import Dataset, load_dataset
from .metrics import controller_metrics
from .optimizer import evaluate_promotion, optimize
from .plant import train_plant
from .plots import (
    plot_coefficients, plot_events, plot_heater_comparison, plot_prediction,
    plot_overshoot_distribution, plot_residuals, plot_simulation, plot_timeline,
)
from .predictor import predict_raw, train_predictor
from .segmentation import extract_events, segment_operating_state
from .simulator import compare_simulations


def prepare(inputs: list[Path], config: ToolConfig) -> tuple[Dataset, pd.DataFrame]:
    dataset = load_dataset(inputs, config)
    featured = recreate_features(dataset.frame, config)
    parity: dict[str, Any] = {}
    for calculated, logged in (
        ("temperature_filtered_c", "temperature_filtered"),
        ("temperature_slope_c_per_s", "logged_temperature_slope_c_per_s"),
        ("temperature_acceleration_c_per_s2", "logged_temperature_acceleration_c_per_s2"),
        ("heat_5s", "logged_heat_5s"), ("heat_15s", "logged_heat_15s"),
        ("heat_30s", "logged_heat_30s"), ("pump_5s", "logged_pump_5s"),
        ("pump_15s", "logged_pump_15s"),
    ):
        logged_values = pd.to_numeric(featured[logged], errors="coerce")
        available = logged_values.notna() & featured[calculated].notna()
        if available.any():
            difference = (featured.loc[available, calculated] - logged_values[available]).abs()
            parity[calculated] = {"rows": int(available.sum()), "maximum_absolute_difference": float(difference.max()), "mean_absolute_difference": float(difference.mean())}
    dataset.quality["logged_feature_parity"] = parity
    aligned = align_future_targets(featured, config.predictor.horizons_seconds, config.sampling.target_tolerance_multiplier)
    return dataset, segment_operating_state(aligned, config)


def _manifest(dataset: Dataset, frame: pd.DataFrame, config: ToolConfig) -> dict[str, Any]:
    sessions = []
    for session_id, group in frame.groupby("session_id", sort=False):
        sessions.append({
            "session_id": session_id, "source_file": group["source_file_name"].iloc[0],
            "rows": int(len(group)), "start": group["timestamp"].min().isoformat(),
            "end": group["timestamp"].max().isoformat(),
            "duration_seconds": (group["timestamp"].max() - group["timestamp"].min()).total_seconds(),
        })
    return {"schema_version": config.schema_version, "dataset_sha256": dataset.dataset_hash, "files": dataset.files, "sessions": sessions}


def validate_workflow(inputs: list[Path], output: Path, config: ToolConfig) -> tuple[Dataset, pd.DataFrame]:
    dataset, frame = prepare(inputs, config)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "data_quality.json", dataset.quality)
    write_json(output / "dataset_manifest.json", _manifest(dataset, frame, config))
    return dataset, frame


def analyze_workflow(inputs: list[Path], output: Path, config: ToolConfig) -> tuple[Dataset, pd.DataFrame, pd.DataFrame]:
    dataset, frame = validate_workflow(inputs, output, config)
    events = extract_events(frame, config)
    frame.to_csv(output / "normalized_sessions.csv", index=False)
    events.to_csv(output / "events.csv", index=False)
    session_metrics = frame.groupby("session_id", as_index=False).agg(
        rows=("timestamp", "size"), start=("timestamp", "min"), end=("timestamp", "max"),
        minimum_temperature_c=("temperature", "min"), maximum_temperature_c=("temperature", "max"),
        mean_temperature_c=("temperature", "mean"), mean_target_c=("target", "mean"),
    )
    session_metrics.to_csv(output / "session_metrics.csv", index=False)
    write_json(output / "current_controller_metrics.json", controller_metrics(frame, config.validation.stable_band_c))
    plot_timeline(frame, output / "plots" / "temperature_timeline.png")
    plot_events(frame, events, output / "plots" / "events")
    plot_overshoot_distribution(events, output / "plots" / "overshoot_distribution.png")
    return dataset, frame, events


def train_predictor_workflow(inputs: list[Path], output: Path, config: ToolConfig) -> tuple[dict[str, Any], pd.DataFrame, Dataset]:
    dataset, frame = prepare(inputs, config)
    result = train_predictor(frame, dataset.dataset_hash, config, [item["sha256"] for item in dataset.files])
    output.mkdir(parents=True, exist_ok=True)
    artifact = canonicalize_predictor(result.artifact)
    write_json(output / "temp_prediction_model.json", artifact)
    joblib.dump(result.fitted_models, output / "temp_prediction_model.joblib")
    write_json(output / "prediction_metrics.json", artifact["metrics"])
    for horizon in config.predictor.horizons_seconds:
        rows = frame[frame["feature_valid"]].dropna(subset=[f"target_{horizon}s_c"])
        if not rows.empty:
            predicted = pd.Series(predict_raw(artifact, horizon, rows[FEATURE_ORDER].to_numpy()), index=rows.index)
            plot_prediction(rows[f"target_{horizon}s_c"], predicted, horizon, output / "plots" / f"prediction_{horizon}s.png")
            plot_residuals(rows[f"target_{horizon}s_c"], predicted, horizon, output / "plots" / f"residuals_{horizon}s.png")
    plot_coefficients(artifact, output / "plots" / "predictor_coefficients.png")
    return artifact, frame, dataset


def train_plant_workflow(inputs: list[Path], output: Path, config: ToolConfig) -> tuple[dict[str, Any], pd.DataFrame, Dataset]:
    dataset, frame = prepare(inputs, config)
    result = train_plant(frame, dataset.dataset_hash, config, [item["sha256"] for item in dataset.files])
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "thermal_plant_model.json", result.artifact)
    joblib.dump(result.fitted_model, output / "thermal_plant_model.joblib")
    return result.artifact, frame, dataset


def simulate_workflow(inputs: list[Path], predictor_path: Path, plant_path: Path, output: Path, config: ToolConfig, settings: PredictionCorrection) -> dict[str, Any]:
    _, frame = prepare(inputs, config)
    predictor = read_json(predictor_path); plant = read_json(plant_path)
    comparison_frame, comparison = compare_simulations(frame, predictor, plant, config, settings)
    output.mkdir(parents=True, exist_ok=True)
    comparison_frame.to_csv(output / "simulation_comparison.csv", index=False)
    write_json(output / "simulation_metrics.json", comparison)
    plot_simulation(comparison_frame, output / "plots" / "simulation_comparison.png")
    plot_heater_comparison(comparison_frame, output / "plots" / "heater_comparison.png")
    return comparison


def optimize_workflow(inputs: list[Path], predictor_path: Path, plant_path: Path, output: Path, config: ToolConfig) -> tuple[PredictionCorrection, dict[str, Any]]:
    _, frame = prepare(inputs, config)
    predictor = read_json(predictor_path); plant = read_json(plant_path)
    candidate, report = optimize(frame, predictor, plant, config)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "optimized_controller.json", {"candidate": asdict(candidate), **report})
    return candidate, report


def _summary(dataset: Dataset, predictor: dict[str, Any], plant: dict[str, Any], optimization: dict[str, Any]) -> str:
    promotion = predictor["promotion"]
    lines = [
        "# PhilcoINO thermal-modeling report", "",
        "> Offline software evidence only. This report does not validate heater hardware, SSR output, wiring, or mains safety.", "",
        "## Dataset", "", f"- SHA-256: `{dataset.dataset_hash}`", f"- Files: {len(dataset.files)}", f"- Sessions: {dataset.quality['sessions']}",
        f"- Faulted rows excluded from training: {dataset.quality['faulted_rows']}", "",
        "## Predictor", "",
    ]
    for horizon, metrics in predictor["metrics"].items():
        lines.append(f"- {horizon}s MAE: {metrics['mae']:.4f} °C; persistence: {metrics['persistence']['mae']:.4f} °C")
    lines += ["", "## Plant model", "", f"- Held-out next-step MAE: {plant['metrics']['mae']:.4f} °C", "", "## Candidate", "",
              f"- Promotion eligible: **{'yes' if promotion['eligible'] else 'no'}**",
              f"- Evaluated configurations: {optimization['evaluated_candidates']}",
              f"- Current simulated peak overshoot: {optimization['comparison']['current']['peak_overshoot_c']:.4f} °C",
              f"- Candidate simulated peak overshoot: {optimization['comparison']['candidate']['peak_overshoot_c']:.4f} °C",
              f"- Current/candidate median recovery: {optimization['comparison']['current']['median_recovery_time_seconds']:.2f}s / {optimization['comparison']['candidate']['median_recovery_time_seconds']:.2f}s"]
    if promotion["reasons"]:
        lines += ["", "Rejection reasons:", ""] + [f"- {reason}" for reason in promotion["reasons"]]
    lines += ["", "Manual approval is required before any firmware change. The workflow never edits firmware.", ""]
    return "\n".join(lines)


def weekly_workflow(inputs: list[Path], output: Path, config: ToolConfig) -> dict[str, Any]:
    dataset, frame, _ = analyze_workflow(inputs, output / "analysis", config)
    predictor_result = train_predictor(frame, dataset.dataset_hash, config, [item["sha256"] for item in dataset.files])
    predictor = canonicalize_predictor(predictor_result.artifact)
    plant_result = train_plant(frame, dataset.dataset_hash, config, [item["sha256"] for item in dataset.files])
    plant = plant_result.artifact
    (output / "models").mkdir(parents=True, exist_ok=True)
    joblib.dump(predictor_result.fitted_models, output / "models" / "temp_prediction_model.joblib")
    joblib.dump(plant_result.fitted_model, output / "models" / "thermal_plant_model.joblib")
    candidate, optimization = optimize(frame, predictor, plant, config)
    simulation_frame, simulation = compare_simulations(frame, predictor, plant, config, candidate)
    controller = {
        "prediction_deadband_c": candidate.deadband_c, "prediction_gain_per_c": candidate.gain_per_c,
        "hard_cutoff_margin_c": candidate.hard_cutoff_margin_c, "activation_band_c": candidate.activation_band_c,
        "horizons": list(candidate.horizons),
    }
    predictor["controller"] = controller
    predictor["promotion"] = evaluate_promotion(predictor, optimization, config)
    write_json(output / "models" / "temp_prediction_model.json", predictor)
    write_json(output / "models" / "thermal_plant_model.json", plant)
    plot_coefficients(predictor, output / "reports" / "predictor_coefficients.png")
    for horizon in config.predictor.horizons_seconds:
        rows = frame[frame["feature_valid"]].dropna(subset=[f"target_{horizon}s_c"])
        if not rows.empty:
            predicted = pd.Series(predict_raw(predictor, horizon, rows[FEATURE_ORDER].to_numpy()), index=rows.index)
            plot_prediction(rows[f"target_{horizon}s_c"], predicted, horizon, output / "reports" / f"prediction_{horizon}s.png")
            plot_residuals(rows[f"target_{horizon}s_c"], predicted, horizon, output / "reports" / f"residuals_{horizon}s.png")
    write_json(output / "optimized_controller.json", {"candidate": asdict(candidate), **optimization})
    write_json(output / "simulation_metrics.json", simulation)
    simulation_frame.to_csv(output / "simulation_comparison.csv", index=False)
    plot_simulation(simulation_frame, output / "reports" / "simulation_comparison.png")
    plot_heater_comparison(simulation_frame, output / "reports" / "heater_comparison.png")
    (output / "model_report.md").write_text(_summary(dataset, predictor, plant, optimization), encoding="utf-8")
    if predictor["promotion"]["eligible"]:
        write_json(output / "exports" / "temp_prediction_model.json", predictor)
        export_firmware(predictor, output / "exports" / "temp_prediction_model.h", config)
    else:
        write_json(output / "rejected_candidate" / "temp_prediction_model.json", predictor)
    return {"promotion": predictor["promotion"], "output": str(output)}
