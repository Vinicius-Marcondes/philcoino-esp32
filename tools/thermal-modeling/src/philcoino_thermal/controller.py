from __future__ import annotations

from dataclasses import dataclass

from .config import ControllerConfig


@dataclass(frozen=True)
class PredictionCorrection:
    deadband_c: float = 0.2
    gain_per_c: float = 0.25
    hard_cutoff_margin_c: float = 0.3
    activation_band_c: float = 8.0
    horizons: tuple[int, ...] = (5, 10, 20)


class FirmwareDutyController:
    def __init__(self, config: ControllerConfig) -> None:
        self.config = config
        self.window_started_s = 0.0
        self.recovery_armed = False
        self.recovery_active = False

    def _ramp_band(self, mode: str, target: float, recovery: bool) -> float:
        if recovery:
            return self.config.steam_recovery_ramp_c if mode == "steam" else self.config.brew_recovery_ramp_c
        if mode == "steam":
            return self.config.steam_ramp_c
        ratio = (target - self.config.brew_target_min_c) / (self.config.brew_target_max_c - self.config.brew_target_min_c)
        ratio = min(1.0, max(0.0, ratio))
        return self.config.brew_ramp_min_c + (self.config.brew_ramp_max_c - self.config.brew_ramp_min_c) * ratio

    def requested_duty(self, temperature: float, target: float, mode: str, brewing: bool, enabled: bool = True) -> float:
        if not enabled:
            return 0.0
        base_error = target - temperature
        if base_error <= 0:
            self.recovery_armed = True
            self.recovery_active = False
        trigger = self.config.steam_recovery_trigger_drop_c if mode == "steam" else self.config.brew_recovery_trigger_drop_c
        if self.recovery_armed and base_error >= trigger:
            self.recovery_active = True
        duty_target = target
        if mode == "brew" and brewing:
            duty_target = min(target + self.config.extraction_duty_offset_c, self.config.brew_over_temperature_c - 1)
        error = duty_target - temperature
        if error <= 0:
            return 0.0
        ramp = self._ramp_band(mode, target, self.recovery_active)
        if error >= ramp:
            return 1.0
        normalized = error / ramp
        duty = normalized if self.recovery_active else normalized * normalized
        minimum = self.config.minimum_heater_pulse_seconds / self.config.heater_window_seconds
        return max(minimum, min(1.0, duty))

    def command_active(self, now_s: float, duty: float, temperature: float, duty_target: float) -> bool:
        if duty <= 0 or temperature >= duty_target:
            self.window_started_s = now_s
            return False
        if now_s - self.window_started_s >= self.config.heater_window_seconds:
            windows = int((now_s - self.window_started_s) // self.config.heater_window_seconds)
            self.window_started_s += windows * self.config.heater_window_seconds
        return now_s - self.window_started_s < duty * self.config.heater_window_seconds


def apply_prediction_correction(baseline_duty: float, temperature: float, target: float, predictions: list[float], settings: PredictionCorrection) -> float:
    if not predictions or temperature < target - settings.activation_band_c:
        return baseline_duty
    predicted_peak = max(predictions)
    risk = predicted_peak - target
    candidate = baseline_duty
    if risk > settings.deadband_c:
        candidate -= settings.gain_per_c * risk
    if predicted_peak >= target + settings.hard_cutoff_margin_c:
        candidate = 0.0
    return max(0.0, min(baseline_duty, candidate))
