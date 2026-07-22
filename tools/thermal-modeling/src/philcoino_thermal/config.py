from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SamplingConfig(StrictModel):
    expected_interval_seconds: float | None = None
    session_gap_multiplier: float = 5.0
    target_tolerance_multiplier: float = 0.6
    minimum_session_seconds: float = 35.0


class FeatureConfig(StrictModel):
    schema_version: int = 1
    filter_alpha: float = 0.25
    minimum_interval_ms: int = 250
    maximum_interval_ms: int = 1000
    maximum_absolute_slope_c_per_s: float = 10.0


class PredictorConfig(StrictModel):
    horizons_seconds: list[int] = Field(default_factory=lambda: [5, 10, 20])
    alpha_values: list[float] = Field(default_factory=lambda: [0.01, 0.1, 1.0, 10.0])


class PlantConfig(StrictModel):
    alpha_values: list[float] = Field(default_factory=lambda: [0.01, 0.1, 1.0, 10.0])


class ControllerConfig(StrictModel):
    brew_target_min_c: int = 85
    brew_target_max_c: int = 95
    brew_over_temperature_c: int = 98
    steam_over_temperature_c: int = 130
    steam_temperature_offset_c: int = 5
    extraction_duty_offset_c: int = 2
    heater_window_seconds: float = 10.0
    minimum_heater_pulse_seconds: float = 0.5
    brew_ramp_min_c: float = 4.0
    brew_ramp_max_c: float = 8.0
    steam_ramp_c: float = 12.0
    brew_recovery_trigger_drop_c: float = 1.0
    steam_recovery_trigger_drop_c: float = 3.0
    brew_recovery_ramp_c: float = 4.0
    steam_recovery_ramp_c: float = 6.0
    recovery_stable_slope_c_per_s: float = 0.05
    recovery_timeout_seconds: float = 60.0
    prediction_deadband_values: list[float]
    prediction_gain_values: list[float]
    hard_cutoff_margin_values: list[float]
    activation_band_values: list[float]


class ValidationConfig(StrictModel):
    stable_band_c: float = 0.5
    maximum_valid_temperature_c: float = 130.0
    maximum_temperature_jump_c_per_s: float = 10.0
    maximum_negative_bias_c: float = 0.5
    minimum_groups_for_promotion: int = 3
    minimum_10s_mae_improvement: float = 0.15
    minimum_rising_mae_improvement: float = 0.20
    minimum_overshoot_improvement: float = 0.30
    maximum_recovery_time_increase: float = 0.20


class ToolConfig(StrictModel):
    schema_version: int = 1
    sampling: SamplingConfig
    features: FeatureConfig
    predictor: PredictorConfig
    plant: PlantConfig
    controller: ControllerConfig
    validation: ValidationConfig
    aliases: dict[str, list[str]]


def default_config_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "default.yaml"


def load_config(path: Path | None = None) -> ToolConfig:
    selected = path or default_config_path()
    with selected.open("r", encoding="utf-8") as handle:
        raw: Any = yaml.safe_load(handle)
    return ToolConfig.model_validate(raw)
