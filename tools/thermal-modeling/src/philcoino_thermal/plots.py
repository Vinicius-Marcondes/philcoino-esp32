from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


def _matplotlib():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        return plt
    except ImportError as error:
        raise RuntimeError("Matplotlib is required to generate report plots. Install the declared project dependencies.") from error


def plot_timeline(frame: pd.DataFrame, output: Path) -> None:
    plt = _matplotlib()
    figure, axis = plt.subplots(figsize=(12, 5))
    axis.plot(frame["timestamp"], frame["temperature"], label="temperature")
    axis.plot(frame["timestamp"], frame["target"], label="target")
    axis.set_ylabel("Temperature (°C)"); axis.legend(loc="upper left"); axis.grid(alpha=0.2)
    second = axis.twinx(); second.step(frame["timestamp"], frame["pump"], label="pump", color="tab:green", alpha=0.5)
    second.set_ylim(-0.05, 1.05); second.set_ylabel("Pump")
    figure.autofmt_xdate(); figure.tight_layout(); output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=140); plt.close(figure)


def plot_prediction(actual: pd.Series, predicted: pd.Series, horizon: int, output: Path) -> None:
    plt = _matplotlib()
    figure, axis = plt.subplots(figsize=(6, 6))
    axis.scatter(actual, predicted, s=8, alpha=0.5)
    low = min(actual.min(), predicted.min()); high = max(actual.max(), predicted.max())
    axis.plot([low, high], [low, high], "k--", linewidth=1)
    axis.set(xlabel="Actual (°C)", ylabel="Predicted (°C)", title=f"{horizon}-second prediction")
    figure.tight_layout(); output.parent.mkdir(parents=True, exist_ok=True); figure.savefig(output, dpi=140); plt.close(figure)


def plot_residuals(actual: pd.Series, predicted: pd.Series, horizon: int, output: Path) -> None:
    plt = _matplotlib()
    figure, axis = plt.subplots(figsize=(7, 4))
    axis.hist((predicted - actual).dropna(), bins=30, color="tab:blue", alpha=0.8)
    axis.axvline(0, color="black", linestyle="--", linewidth=1)
    axis.set(xlabel="Prediction error (°C)", ylabel="Rows", title=f"{horizon}-second residuals")
    figure.tight_layout(); output.parent.mkdir(parents=True, exist_ok=True); figure.savefig(output, dpi=140); plt.close(figure)


def plot_coefficients(model: dict[str, Any], output: Path) -> None:
    plt = _matplotlib()
    figure, axes = plt.subplots(3, 1, figsize=(10, 9), sharex=True)
    for axis, horizon in zip(axes, (5, 10, 20), strict=True):
        axis.bar(model["feature_order"], model["models"][str(horizon)]["coefficients"])
        axis.set_title(f"{horizon}-second coefficients"); axis.grid(axis="y", alpha=0.2)
    axes[-1].tick_params(axis="x", rotation=45); figure.tight_layout(); output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=140); plt.close(figure)


def plot_events(frame: pd.DataFrame, events: pd.DataFrame, output_directory: Path) -> None:
    if events.empty: return
    plt = _matplotlib(); output_directory.mkdir(parents=True, exist_ok=True)
    for _, event in events[events["event_type"] == "BREWING"].iterrows():
        start = pd.Timestamp(event["start_time"]); end = pd.Timestamp(event["end_time"]) + pd.Timedelta(seconds=60)
        subset = frame[(frame["session_id"] == event["session_id"]) & frame["timestamp"].between(start, end)]
        if subset.empty: continue
        figure, axis = plt.subplots(figsize=(9, 4)); axis.plot(subset["timestamp"], subset["temperature"], label="temperature")
        axis.plot(subset["timestamp"], subset["target"], "k--", label="target"); axis.axvspan(start, pd.Timestamp(event["end_time"]), color="tab:green", alpha=0.15)
        axis.legend(); axis.grid(alpha=0.2); figure.autofmt_xdate(); figure.tight_layout(); figure.savefig(output_directory / f"{event['event_id']}.png", dpi=140); plt.close(figure)


def plot_overshoot_distribution(events: pd.DataFrame, output: Path) -> None:
    brewing = events[events["event_type"] == "BREWING"] if not events.empty else events
    if brewing.empty: return
    plt = _matplotlib(); figure, axis = plt.subplots(figsize=(7, 4))
    axis.hist(brewing["post_event_overshoot_c"].dropna(), bins=min(20, max(5, len(brewing))), color="tab:red", alpha=0.75)
    axis.set(xlabel="Post-event overshoot (°C)", ylabel="Events", title="Historical overshoot distribution")
    figure.tight_layout(); output.parent.mkdir(parents=True, exist_ok=True); figure.savefig(output, dpi=140); plt.close(figure)


def plot_simulation(frame: pd.DataFrame, output: Path) -> None:
    plt = _matplotlib()
    figure, axis = plt.subplots(figsize=(12, 5))
    for configuration, subset in frame.groupby("configuration"):
        axis.plot(subset["timestamp"], subset["temperature"], label=str(configuration), alpha=0.8)
    target = frame[frame["configuration"] == frame["configuration"].iloc[0]]
    axis.plot(target["timestamp"], target["target"], "k--", label="target")
    axis.set_ylabel("Temperature (°C)"); axis.legend(); axis.grid(alpha=0.2); figure.autofmt_xdate(); figure.tight_layout()
    output.parent.mkdir(parents=True, exist_ok=True); figure.savefig(output, dpi=140); plt.close(figure)


def plot_heater_comparison(frame: pd.DataFrame, output: Path) -> None:
    plt = _matplotlib(); figure, axis = plt.subplots(figsize=(12, 4))
    for configuration, subset in frame.groupby("configuration"):
        axis.step(subset["timestamp"], subset["simulated_heater_duty"], where="post", label=str(configuration), alpha=0.75)
    axis.set(ylim=(-0.05, 1.05), ylabel="Heater command", title="Current vs candidate heater command")
    axis.legend(); axis.grid(alpha=0.2); figure.autofmt_xdate(); figure.tight_layout(); output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=140); plt.close(figure)
