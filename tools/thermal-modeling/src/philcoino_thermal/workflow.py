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
from .predictor import predict_raw, predictor_evaluation_rows, train_predictor
from .scope import modeling_scope_summary
from .segmentation import extract_events, segment_operating_state
from .simulator import compare_simulations


def prepare(inputs: list[Path], config: ToolConfig) -> tuple[Dataset, pd.DataFrame]:
    dataset = load_dataset(inputs, config)
    reconstructed = recreate_features(dataset.frame, config, prefer_logged=False)
    featured = recreate_features(dataset.frame, config, prefer_logged=True)
    logged_usable = (
        featured["logged_prediction_usable"]
        .astype("string")
        .str.strip()
        .str.lower()
        .isin({"true", "1"})
    )
    restrict_parity_to_usable = featured["logged_prediction_usable"].notna().any()
    parity: dict[str, Any] = {}
    for calculated, logged in (
        ("temperature_filtered_c", "temperature_filtered"),
        ("temperature_slope_c_per_s", "logged_temperature_slope_c_per_s"),
        ("temperature_acceleration_c_per_s2", "logged_temperature_acceleration_c_per_s2"),
        ("heat_5s", "logged_heat_5s"), ("heat_15s", "logged_heat_15s"),
        ("heat_30s", "logged_heat_30s"), ("pump_5s", "logged_pump_5s"),
        ("pump_15s", "logged_pump_15s"),
    ):
        logged_values = pd.to_numeric(reconstructed[logged], errors="coerce")
        available = logged_values.notna() & reconstructed[calculated].notna()
        if restrict_parity_to_usable:
            available &= logged_usable
        if available.any():
            difference = (reconstructed.loc[available, calculated] - logged_values[available]).abs()
            parity[calculated] = {"rows": int(available.sum()), "maximum_absolute_difference": float(difference.max()), "mean_absolute_difference": float(difference.mean())}
    dataset.quality["logged_feature_parity"] = parity
    dataset.quality["logged_feature_parity_scope"] = (
        "logged_prediction_usable_rows" if restrict_parity_to_usable else "all_logged_rows"
    )
    dataset.quality["modeling_scope"] = modeling_scope_summary(featured, config)
    dataset.quality["feature_source_rows"] = {
        str(source): int(count)
        for source, count in featured["feature_source"].value_counts().items()
    }
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
            "boundary_reason": str(group["session_boundary_reason"].iloc[0]),
        })
    return {
        "schema_version": config.schema_version,
        "dataset_sha256": dataset.dataset_hash,
        "files": dataset.files,
        "modeling_scope": dataset.quality["modeling_scope"],
        "sessions": sessions,
    }


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
        rows = predictor_evaluation_rows(frame, artifact, horizon)
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


def _improvement(candidate: float, baseline: float) -> float | None:
    return None if abs(baseline) < 1e-9 else 100.0 * (1.0 - candidate / baseline)


def _signed_percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.1f}%"


def _summary(
    dataset: Dataset,
    frame: pd.DataFrame,
    events: pd.DataFrame,
    predictor: dict[str, Any],
    plant: dict[str, Any],
    optimization: dict[str, Any],
    candidate: PredictionCorrection,
) -> str:
    promotion = predictor["promotion"]
    current = optimization["comparison"]["current"]
    proposed = optimization["comparison"]["candidate"]
    status = "ELIGIBLE FOR MANUAL REVIEW" if promotion["eligible"] else "REJECTED"
    candidate_artifact = "exports/temp_prediction_model.json" if promotion["eligible"] else "rejected_candidate/temp_prediction_model.json"
    actual_duty_available = not any(item["boolean_heater_fallback"] for item in dataset.files)
    event_counts = events["event_type"].value_counts().to_dict() if "event_type" in events else {}
    modeling_scope = dataset.quality["modeling_scope"]
    independent_groups = len(set(predictor["training_sessions"] + predictor["test_sessions"]))

    insights: list[str] = []
    if not actual_duty_available:
        insights.append("Actual heater duty was not logged; Boolean heater state was used, so plant-model and counterfactual confidence are reduced.")
    if dataset.quality["faulted_rows"]:
        insights.append(f"{dataset.quality['faulted_rows']} faulted row(s) were retained for diagnostics and excluded from training.")
    if independent_groups < 3:
        insights.append("Fewer than three independent sessions were available, which blocks promotion.")
    if dataset.quality["ignored_uptime_backsteps"]:
        insights.append(
            f"{dataset.quality['ignored_uptime_backsteps']} small uptime backstep(s) were treated as export timing jitter rather than false machine restarts."
        )
    logged_feature_rows = dataset.quality["feature_source_rows"].get("logged_firmware", 0)
    if logged_feature_rows:
        insights.append(
            f"{logged_feature_rows} row(s) used complete firmware-authored diagnostic features; remaining rows used causal reconstruction."
        )
    if proposed.get("extrapolation_steps_detected"):
        features = ", ".join(proposed.get("extrapolation_features", [])) or "unknown inputs"
        insights.append(f"Candidate simulation left the plant training range for: {features}.")
    if proposed.get("safety_violation_count", 0):
        insights.append(f"Candidate simulation crossed a firmware over-temperature limit {int(proposed['safety_violation_count'])} time(s).")
    ten_second = predictor["metrics"].get("10")
    if ten_second:
        gain = _improvement(ten_second["mae"], ten_second["persistence"]["mae"])
        insights.append(f"The 10-second predictor changed MAE versus persistence by {_signed_percent(gain)}; positive means improvement.")
    overshoot_gain = _improvement(proposed["peak_overshoot_c"], current["peak_overshoot_c"])
    insights.append(f"The candidate changed simulated peak overshoot by {_signed_percent(overshoot_gain)}; positive means improvement.")
    if proposed.get("correction_active_steps", 0) <= 0:
        insights.append("The predictive layer never reduced requested heater duty during the eligible simulation segments.")
    if not insights:
        insights.append("No automatic data-quality or simulation warning was detected.")

    lines = [
        "# PhilcoINO thermal-modeling report", "",
        f"## Decision: {status}", "",
        "> This is offline software evidence only. It does not validate heater hardware, SSR output, wiring, sensor placement, flow, or mains safety.", "",
        ("The candidate passed the configured offline gates, but still requires manual review and a separate firmware change."
         if promotion["eligible"] else
         "The candidate failed one or more configured gates. Do not generate or apply a firmware header from this run."), "",
        "## Executive insights", "",
    ]
    lines += [f"- {insight}" for insight in insights]
    if promotion["reasons"]:
        lines += ["", "### Promotion blockers", ""] + [f"- {reason}" for reason in promotion["reasons"]]

    lines += [
        "", "## Dataset and data quality", "",
        f"- Dataset SHA-256: `{dataset.dataset_hash}`",
        f"- Rows: {dataset.quality['rows']}",
        f"- Source files: {len(dataset.files)}",
        f"- Continuous sessions: {dataset.quality['sessions']}",
        f"- Session boundary reasons: `{dataset.quality['session_boundary_counts']}`",
        f"- Ignored small uptime backsteps: {dataset.quality['ignored_uptime_backsteps']} "
        f"(largest {dataset.quality['largest_ignored_uptime_backstep_ms']:.0f} ms)",
        f"- Logged time span: {(frame['timestamp'].max() - frame['timestamp'].min()).total_seconds():.1f} seconds",
        f"- Machine modes present: `{', '.join(sorted(frame['mode'].dropna().astype(str).unique()))}`",
        f"- Brewing events: {int(event_counts.get('BREWING', 0))}",
        f"- Warm-up events: {int(event_counts.get('WARMUP', 0))}",
        f"- Recovery events: {int(event_counts.get('POST_BREW_RECOVERY', 0))}",
        f"- Faulted rows excluded from fitting: {dataset.quality['faulted_rows']}",
        f"- Feature sources: `{dataset.quality['feature_source_rows']}`",
        f"- Actual heater duty available: **{'yes' if actual_duty_available else 'no'}**", "",
        "### Modeling scope", "",
        f"- Active machine modes: `{', '.join(modeling_scope['active_modes'])}`",
        f"- Healthy rows inside scope: {modeling_scope['included_rows']}",
        f"- Rows excluded because of active mode: {modeling_scope['excluded_mode_rows']}",
        f"- Faulted in-scope rows excluded: {modeling_scope['excluded_fault_rows']}",
        "- Excluded rows remain present in the normalized data and historical analysis.", "",
        "| Source file | Rows | SHA-256 | Duty source |", "| --- | ---: | --- | --- |",
    ]
    for item in dataset.files:
        duty_source = item["heater_duty_source"] or "Boolean heater_active fallback"
        lines.append(f"| `{Path(item['path']).name}` | {item['rows_after_exact_deduplication']} | `{item['sha256']}` | {duty_source} |")
    if dataset.quality["warnings"]:
        lines += ["", "Data-quality warnings:", ""] + [f"- {warning}" for warning in dataset.quality["warnings"]]
    lines += [
        "", "Detailed evidence: [quality report](analysis/data_quality.json), [dataset manifest](analysis/dataset_manifest.json), "
        "[session metrics](analysis/session_metrics.csv), [detected events](analysis/events.csv), and "
        "[normalized rows](analysis/normalized_sessions.csv).", "",
        "![Temperature and target timeline](analysis/plots/temperature_timeline.png)", "",
        "## Leakage-safe split", "",
        (
            "Rows were not randomly split. Earlier complete sessions trained and selected the Ridge strength; the latest complete session was untouched until final testing."
            if predictor["evaluation_type"] == "held_out"
            else
            "Only one complete independent session was available. Metrics below are training-only diagnostics and are not held-out evidence."
        ), "",
        f"- Evaluation type: **{predictor['evaluation_type']}**",
        f"- Independent complete session groups: {independent_groups}",
        f"- Training sessions: `{', '.join(predictor['training_sessions']) or 'none'}`",
        f"- Chronological validation sessions: `{', '.join(predictor.get('validation_sessions', [])) or 'none'}`",
        f"- Final test sessions: `{', '.join(predictor['test_sessions']) or 'none'}`",
        f"- Metric evaluation sessions: `{', '.join(predictor['evaluation_sessions']) or 'none'}`",
        "- Evaluation rows by horizon: "
        + ", ".join(
            f"{horizon}s={predictor['metrics'][str(horizon)]['count']}"
            for horizon in predictor["horizons_seconds"]
        ),
        f"- Feature schema version: `{predictor['feature_schema_version']}`",
        f"- Predictor model version: `{predictor['model_version']}`",
        "- Firmware configuration version: not present in the CSV; confirm it manually before using an export.", "",
        "## Future-temperature predictor", "",
        f"These are **{predictor['evaluation_type'].replace('_', '-')}** metrics. MAE is the typical absolute prediction error. The improvement column compares Ridge against the simple persistence guess; positive is better.", "",
        "| Horizon | Ridge MAE | Persistence MAE | Improvement | Bias | Near-target rising MAE |", "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for horizon in sorted(predictor["metrics"], key=int):
        metrics = predictor["metrics"][horizon]
        rising = metrics.get("near_target_rising")
        gain = _improvement(metrics["mae"], metrics["persistence"]["mae"])
        rising_text = "n/a" if not rising else f"{rising['mae']:.4f} °C"
        lines.append(f"| {horizon}s | {metrics['mae']:.4f} °C | {metrics['persistence']['mae']:.4f} °C | {_signed_percent(gain)} | {metrics['bias']:+.4f} °C | {rising_text} |")
    lines += [
        "", "Key predictor charts:", "",
        "- [5-second predicted versus actual](reports/prediction_5s.png) and [residuals](reports/residuals_5s.png)",
        "- [10-second predicted versus actual](reports/prediction_10s.png) and [residuals](reports/residuals_10s.png)",
        "- [20-second predicted versus actual](reports/prediction_20s.png) and [residuals](reports/residuals_20s.png)",
        "- [Feature coefficients](reports/predictor_coefficients.png)", "",
        "How to read the prediction graphs: each blue dot compares the actual future boiler temperature on the horizontal axis with the model-predicted temperature on the vertical axis. Points close to the dashed diagonal are accurate. Points above the line predicted too hot. Points below predicted too cold.", "",
        "## Thermal plant model", "",
        "The ARX plant model is used only for offline counterfactual simulation. It predicts the next temperature change from temperature, heater, pump, mode, and recent history.", "",
        f"- Evaluation type: **{plant['evaluation_type']}**",
        f"- {('Held-out' if plant['evaluation_type'] == 'held_out' else 'Training-only')} next-step MAE: **{plant['metrics']['mae']:.4f} °C**",
        f"- Boolean heater fallback used: **{'yes' if plant['boolean_heater_fallback'] else 'no'}**",
        f"- Extrapolation detected for candidate: **{'yes' if proposed.get('extrapolation_steps_detected') else 'no'}**", "",
        f"- Plant training sessions: `{', '.join(plant['training_sessions']) or 'none'}`",
        f"- Plant test sessions: `{', '.join(plant['test_sessions']) or 'none'}`", "",
        "Detailed model: [thermal_plant_model.json](models/thermal_plant_model.json).", "",
        "## Candidate controller settings", "",
        "The predictive layer may only reduce the firmware duty-curve request; it never increases heater duty.", "",
        "| Setting | Candidate value | Meaning |", "| --- | ---: | --- |",
        f"| Prediction deadband | {candidate.deadband_c:.4f} °C | Ignore smaller predicted overshoot |",
        f"| Prediction gain | {candidate.gain_per_c:.4f} duty/°C | Strength of duty reduction |",
        f"| Hard-cutoff margin | {candidate.hard_cutoff_margin_c:.4f} °C | Predicted margin that requests zero duty |",
        f"| Activation band | {candidate.activation_band_c:.4f} °C | Distance below target where prediction becomes active |",
        f"| Horizons | {', '.join(f'{value}s' for value in candidate.horizons)} | Forecasts used to calculate predicted peak |", "",
        f"The optimizer evaluated **{optimization['evaluated_candidates']}** bounded configurations. Exact details: [optimized_controller.json](optimized_controller.json).", "",
        f"- Candidate prediction steps: {int(proposed.get('prediction_steps', 0))}",
        f"- Candidate duty-reduction steps: {int(proposed.get('correction_active_steps', 0))}",
        f"- Total requested-duty reduction: {proposed.get('total_requested_duty_reduction', 0.0):.4f}", "",
        "## Current versus candidate simulation", "",
        "| Metric | Current controller | Candidate | Change |", "| --- | ---: | ---: | ---: |",
    ]
    for label, key, unit, improvement_direction in (
        ("Peak overshoot", "peak_overshoot_c", "°C", True),
        ("Maximum undershoot", "maximum_undershoot_c", "°C", True),
        ("Mean absolute target error", "mean_absolute_target_error_c", "°C", True),
        ("Median recovery", "median_recovery_time_seconds", "s", True),
        ("Heater switching", "heater_switching_count", "switches", True),
        ("Mean heater duty", "mean_heater_duty", "", False),
    ):
        change = _improvement(proposed[key], current[key]) if improvement_direction else None
        lines.append(f"| {label} | {current[key]:.4f} {unit} | {proposed[key]:.4f} {unit} | {_signed_percent(change)} |")
    lines += [
        "", "![Current versus candidate temperature](reports/simulation_comparison.png)", "",
        "![Current versus candidate heater command](reports/heater_comparison.png)", "",
        "Raw simulation evidence: [simulation metrics](simulation_metrics.json) and [step-by-step comparison](simulation_comparison.csv).", "",
        "## Artifact index", "",
        "### Read first", "",
        "- [Data-quality report](analysis/data_quality.json)",
        "- [Current-controller metrics](analysis/current_controller_metrics.json)",
        "- [Simulation metrics](simulation_metrics.json)",
        f"- [Final candidate model]({candidate_artifact})", "",
        "### Models and reproducibility", "",
        "- [Canonical predictor JSON](models/temp_prediction_model.json)",
        "- [Canonical plant JSON](models/thermal_plant_model.json)",
        "- [Predictor joblib artifact](models/temp_prediction_model.joblib)",
        "- [Plant joblib artifact](models/thermal_plant_model.joblib)", "",
        "### Plots and detailed tables", "",
        "- [Analysis plot directory](analysis/plots/)",
        "- [Model and simulation plot directory](reports/)",
        "- [Event table](analysis/events.csv)",
        "- [Session table](analysis/session_metrics.csv)", "",
        "## Review boundary and next action", "",
        ("Review the linked evidence, then create a separate firmware change if the candidate is manually accepted."
         if promotion["eligible"] else
         "Resolve the promotion blockers or collect better data, then run `weekly-run` again. Do not copy this rejected candidate into firmware."), "",
        "The workflow never edits or flashes firmware. Manual approval and supervised physical validation remain mandatory.", "",
    ]
    return "\n".join(lines)


def weekly_workflow(inputs: list[Path], output: Path, config: ToolConfig) -> dict[str, Any]:
    dataset, frame, events = analyze_workflow(inputs, output / "analysis", config)
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
        rows = predictor_evaluation_rows(frame, predictor, horizon)
        if not rows.empty:
            predicted = pd.Series(predict_raw(predictor, horizon, rows[FEATURE_ORDER].to_numpy()), index=rows.index)
            plot_prediction(rows[f"target_{horizon}s_c"], predicted, horizon, output / "reports" / f"prediction_{horizon}s.png")
            plot_residuals(rows[f"target_{horizon}s_c"], predicted, horizon, output / "reports" / f"residuals_{horizon}s.png")
    write_json(output / "optimized_controller.json", {"candidate": asdict(candidate), **optimization})
    write_json(output / "simulation_metrics.json", simulation)
    simulation_frame.to_csv(output / "simulation_comparison.csv", index=False)
    plot_simulation(simulation_frame, output / "reports" / "simulation_comparison.png")
    plot_heater_comparison(simulation_frame, output / "reports" / "heater_comparison.png")
    (output / "model_report.md").write_text(
        _summary(dataset, frame, events, predictor, plant, optimization, candidate),
        encoding="utf-8",
    )
    if predictor["promotion"]["eligible"]:
        write_json(output / "exports" / "temp_prediction_model.json", predictor)
        export_firmware(predictor, output / "exports" / "temp_prediction_model.h", config)
    else:
        write_json(output / "rejected_candidate" / "temp_prediction_model.json", predictor)
    return {"promotion": predictor["promotion"], "output": str(output)}
