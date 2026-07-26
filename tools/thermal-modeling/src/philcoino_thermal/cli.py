from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .artifacts import export_firmware, read_json
from .config import load_config
from .controller import PredictionCorrection
from .workflow import (
    analyze_workflow, optimize_workflow, simulate_workflow, train_plant_workflow,
    train_predictor_workflow, validate_workflow, weekly_workflow,
)


def _common(command: argparse.ArgumentParser) -> None:
    command.add_argument("inputs", nargs="+", type=Path, help="CSV files or directories containing CSV exports")
    command.add_argument("--output", required=True, type=Path)
    command.add_argument("--config", type=Path)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="philcoino-thermal")
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("validate", "analyze", "train-predictor", "train-plant", "weekly-run"):
        _common(commands.add_parser(name))
    for name in ("simulate", "optimize"):
        command = commands.add_parser(name); _common(command)
        command.add_argument("--predictor", required=True, type=Path); command.add_argument("--plant", required=True, type=Path)
    simulate = commands.choices["simulate"]
    simulate.add_argument("--prediction-deadband", type=float, default=0.2)
    simulate.add_argument("--prediction-gain", type=float, default=0.25)
    simulate.add_argument("--hard-cutoff-margin", type=float, default=0.3)
    simulate.add_argument("--activation-band", type=float, default=8.0)
    export = commands.add_parser("export-firmware")
    export.add_argument("model", type=Path); export.add_argument("--output", required=True, type=Path); export.add_argument("--config", type=Path)
    return root


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    config = load_config(arguments.config)
    try:
        if arguments.command == "validate": validate_workflow(arguments.inputs, arguments.output, config)
        elif arguments.command == "analyze": analyze_workflow(arguments.inputs, arguments.output, config)
        elif arguments.command == "train-predictor": train_predictor_workflow(arguments.inputs, arguments.output, config)
        elif arguments.command == "train-plant": train_plant_workflow(arguments.inputs, arguments.output, config)
        elif arguments.command == "simulate":
            settings = PredictionCorrection(arguments.prediction_deadband, arguments.prediction_gain, arguments.hard_cutoff_margin, arguments.activation_band)
            simulate_workflow(arguments.inputs, arguments.predictor, arguments.plant, arguments.output, config, settings)
        elif arguments.command == "optimize": optimize_workflow(arguments.inputs, arguments.predictor, arguments.plant, arguments.output, config)
        elif arguments.command == "export-firmware": export_firmware(read_json(arguments.model), arguments.output, config)
        elif arguments.command == "weekly-run": weekly_workflow(arguments.inputs, arguments.output, config)
    except (ValueError, RuntimeError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0
