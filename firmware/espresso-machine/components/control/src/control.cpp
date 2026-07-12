#include "philcoino/control.hpp"

#include <cmath>

#include "philcoino/config.hpp"

namespace philcoino::control {
namespace {

bool elapsed(std::uint32_t now_ms, std::uint32_t since_ms,
             std::uint32_t duration_ms) {
  return static_cast<std::uint32_t>(now_ms - since_ms) >= duration_ms;
}

bool reading_ok(const peripherals::ThermocoupleReading& reading) {
  return reading.status == peripherals::ThermocoupleStatus::kOk &&
         std::isfinite(reading.temperature_c);
}

bool over_temperature(const peripherals::ThermocoupleReadings& readings,
                      ControlMode mode, bool dual_thermocouples_enabled) {
  if (!dual_thermocouples_enabled) {
    const auto limit = mode == ControlMode::kBrew
                           ? config::kBrewOverTemperatureC
                           : config::kSteamOverTemperatureC;
    return readings.brew.temperature_c >= static_cast<float>(limit);
  }
  return readings.brew.temperature_c >= config::kBrewOverTemperatureC ||
         readings.steam.temperature_c >= config::kSteamOverTemperatureC;
}

}  // namespace

const char* fault_code_name(FaultCode code) {
  switch (code) {
    case FaultCode::kSensorFailure: return "sensor_failure";
    case FaultCode::kOverTemperature: return "over_temperature";
    case FaultCode::kHeatingTimeout: return "heating_timeout";
    case FaultCode::kInternalError: return "internal_error";
  }
  return "internal_error";
}

const char* fault_message(FaultCode code) {
  switch (code) {
    case FaultCode::kSensorFailure:
      return "A thermocouple reading is unavailable, invalid, or implausible.";
    case FaultCode::kOverTemperature:
      return "A monitored temperature exceeded the configured safety limit.";
    case FaultCode::kHeatingTimeout:
      return "The active boiler sensor did not reach readiness in time.";
    case FaultCode::kInternalError:
      return "Temperature control entered a safe fault state.";
  }
  return "Temperature control entered a safe fault state.";
}

TemperatureController::TemperatureController(
    peripherals::TemperatureTargets targets, peripherals::FailOffSsr& heater,
    bool dual_thermocouples_enabled)
    : heater_(heater),
      targets_(targets),
      dual_thermocouples_enabled_(dual_thermocouples_enabled) {
  if (!peripherals::targets_are_valid(targets_)) {
    targets_ = {};
    latch_fault(FaultCode::kInternalError);
  }
}

ControlMode TemperatureController::mode() const { return mode_; }

ControlStatus TemperatureController::status() const { return status_; }

const peripherals::TemperatureTargets& TemperatureController::targets() const {
  return targets_;
}

bool TemperatureController::has_fault() const { return fault_latched_; }

FaultCode TemperatureController::fault_code() const { return fault_code_; }

bool TemperatureController::heater_enabled_permission() const {
  return heater_enabled_permission_;
}

bool TemperatureController::heater_enabled() const { return heater_.is_enabled(); }

bool TemperatureController::set_mode(ControlMode mode, std::uint32_t now_ms) {
  if (mode_ == mode) {
    return true;
  }
  mode_ = mode;
  reset_readiness(now_ms);
  reset_heater_control_window(now_ms);
  heating_demand_active_ = false;
  reset_recovery_heat();
  steam_timeout_active_ = false;
  if (fault_latched_) {
    status_ = ControlStatus::kFault;
    return heater_.force_off();
  }
  status_ = ControlStatus::kHeating;
  if (!heater_.force_off()) {
    latch_fault(FaultCode::kInternalError);
    return false;
  }
  return true;
}

bool TemperatureController::set_heater_enabled(bool enabled,
                                               std::uint32_t now_ms) {
  if (enabled && heater_.safety_cutoff_tripped()) {
    latch_fault(FaultCode::kInternalError);
    return false;
  }
  if (heater_enabled_permission_ == enabled) {
    return enabled || heater_.force_off();
  }
  heater_enabled_permission_ = enabled;
  reset_heater_control_window(now_ms);
  heating_demand_active_ = false;
  reset_recovery_heat();
  if (!enabled || fault_latched_) {
    return heater_.force_off();
  }
  return true;
}

bool TemperatureController::update_targets(
    const peripherals::TemperatureTargets& targets,
    peripherals::TargetStorage& storage, std::uint32_t now_ms) {
  if (!peripherals::targets_are_valid(targets)) {
    return false;
  }
  if (!heater_.force_off()) {
    latch_fault(FaultCode::kInternalError);
    return false;
  }
  if (!storage.save(targets)) {
    return false;
  }
  targets_ = targets;
  reset_readiness(now_ms);
  reset_heater_control_window(now_ms);
  heating_demand_active_ = false;
  reset_recovery_heat();
  steam_timeout_active_ = false;
  if (!fault_latched_) {
    status_ = ControlStatus::kHeating;
  }
  return true;
}

bool TemperatureController::update_brew_target(
    std::int32_t brew_c, peripherals::TargetStorage& storage,
    std::uint32_t now_ms) {
  auto targets = targets_;
  targets.brew_c = brew_c;
  return update_targets(targets, storage, now_ms);
}

bool TemperatureController::update_steam_target(
    std::int32_t steam_c, peripherals::TargetStorage& storage,
    std::uint32_t now_ms) {
  auto targets = targets_;
  targets.steam_c = steam_c;
  return update_targets(targets, storage, now_ms);
}

bool TemperatureController::dismiss_over_temperature(std::uint32_t now_ms) {
  if (!fault_latched_ || fault_code_ != FaultCode::kOverTemperature ||
      !monitored_readings_ok() || !active_temperature_back_at_target() ||
      over_temperature(readings_, mode_, dual_thermocouples_enabled_)) {
    return false;
  }
  fault_latched_ = false;
  reset_readiness(now_ms);
  reset_heater_control_window(now_ms);
  heating_demand_active_ = false;
  reset_recovery_heat();
  return !update(readings_, now_ms).fault_active;
}

ControlSnapshot TemperatureController::update(
    const peripherals::ThermocoupleReadings& readings, std::uint32_t now_ms) {
  readings_ = readings;

  if (heater_.safety_cutoff_tripped()) {
    latch_fault(FaultCode::kInternalError);
    return snapshot(now_ms);
  }

  if (fault_latched_) {
    status_ = ControlStatus::kFault;
    heater_.force_off();
    return snapshot(now_ms);
  }

  if (!validate_readings(now_ms)) {
    return snapshot(now_ms);
  }

  if (mode_ == ControlMode::kSteam && steam_timeout_active_ &&
      elapsed(now_ms, steam_timeout_started_ms_, config::kSteamReadyTimeoutMs)) {
    return_to_brew(now_ms);
  }

  const bool ready = update_readiness(now_ms);
  status_ = ready ? ControlStatus::kReady : ControlStatus::kHeating;

  if (mode_ == ControlMode::kSteam && ready && !steam_timeout_active_) {
    steam_timeout_active_ = true;
    steam_timeout_started_ms_ = now_ms;
  }

  if (!heater_enabled_permission_) {
    heating_demand_active_ = false;
  } else if (active_temperature_demands_heat() && !ready) {
    if (!heating_demand_active_) {
      heating_demand_active_ = true;
      heating_demand_since_ms_ = now_ms;
    } else if (elapsed(now_ms, heating_demand_since_ms_,
                       config::kHeatingTimeoutMs)) {
      latch_fault(FaultCode::kHeatingTimeout);
      return snapshot(now_ms);
    }
  } else {
    heating_demand_active_ = false;
  }

  update_recovery_heat();
  if (!update_heater(now_ms)) {
    latch_fault(FaultCode::kInternalError);
  }

  return snapshot(now_ms);
}

ControlSnapshot TemperatureController::snapshot(std::uint32_t now_ms) const {
  ControlSnapshot value{};
  value.status = fault_latched_ ? ControlStatus::kFault : status_;
  value.mode = mode_;
  value.targets = targets_;
  value.readings = readings_;
  value.heater_enabled_permission = heater_enabled_permission_;
  value.heater_enabled =
      !fault_latched_ && heater_enabled_permission_ && heater_.is_enabled();
  value.fault_active = fault_latched_;
  value.fault = {fault_code_, fault_message(fault_code_)};
  value.steam_timeout = steam_timeout_snapshot(now_ms);
  return value;
}

void TemperatureController::latch_fault(FaultCode code) {
  fault_latched_ = true;
  fault_code_ = code;
  status_ = ControlStatus::kFault;
  heater_.force_off();
}

std::int32_t TemperatureController::active_target() const {
  return mode_ == ControlMode::kBrew ? targets_.brew_c : targets_.steam_c;
}

float TemperatureController::active_temperature() const {
  if (!dual_thermocouples_enabled_) {
    return readings_.brew.temperature_c;
  }
  return mode_ == ControlMode::kBrew ? readings_.brew.temperature_c
                                     : readings_.steam.temperature_c;
}

bool TemperatureController::active_temperature_in_ready_band() const {
  return std::fabs(active_temperature() - static_cast<float>(active_target())) <=
         static_cast<float>(config::kReadyBandC);
}

bool TemperatureController::active_temperature_demands_heat() const {
  return active_temperature() < static_cast<float>(active_target());
}

bool TemperatureController::monitored_readings_ok() const {
  return reading_ok(readings_.brew) &&
         (!dual_thermocouples_enabled_ || reading_ok(readings_.steam));
}

bool TemperatureController::active_temperature_back_at_target() const {
  return active_temperature() <= static_cast<float>(active_target());
}

float TemperatureController::active_heat_ramp_band() const {
  if (mode_ == ControlMode::kSteam) {
    return config::kSteamHeatRampBandC;
  }

  const float target_span = static_cast<float>(config::kBrewTargetMaximumC -
                                               config::kBrewTargetMinimumC);
  const float target_offset =
      static_cast<float>(active_target() - config::kBrewTargetMinimumC);
  const float target_ratio = target_offset / target_span;
  return config::kBrewHeatRampMinimumTargetBandC +
         (config::kBrewHeatRampBandC -
          config::kBrewHeatRampMinimumTargetBandC) *
             target_ratio;
}

float TemperatureController::active_recovery_trigger_drop() const {
  return mode_ == ControlMode::kBrew ? config::kBrewRecoveryTriggerDropC
                                     : config::kSteamRecoveryTriggerDropC;
}

float TemperatureController::active_recovery_heat_ramp_band() const {
  return mode_ == ControlMode::kBrew ? config::kBrewRecoveryHeatRampBandC
                                     : config::kSteamRecoveryHeatRampBandC;
}

void TemperatureController::reset_recovery_heat() {
  recovery_heat_armed_ = false;
  recovery_heat_active_ = false;
}

void TemperatureController::update_recovery_heat() {
  const float temperature_error =
      static_cast<float>(active_target()) - active_temperature();
  if (temperature_error <= 0.0F) {
    recovery_heat_armed_ = true;
    recovery_heat_active_ = false;
    return;
  }
  if (recovery_heat_armed_ &&
      temperature_error >= active_recovery_trigger_drop()) {
    recovery_heat_active_ = true;
  }
}

std::uint32_t TemperatureController::heater_pulse_ms() const {
  const float temperature_error =
      static_cast<float>(active_target()) - active_temperature();
  if (temperature_error <= 0.0F) {
    return 0;
  }

  const float ramp_band = recovery_heat_active_ ? active_recovery_heat_ramp_band()
                                                : active_heat_ramp_band();
  if (temperature_error >= ramp_band) {
    return config::kHeaterControlWindowMs;
  }

  const float normalized_error = temperature_error / ramp_band;
  const float curved_duty =
      recovery_heat_active_ ? normalized_error : normalized_error * normalized_error;
  auto pulse_ms = static_cast<std::uint32_t>(
      static_cast<float>(config::kHeaterControlWindowMs) * curved_duty);
  if (pulse_ms < config::kMinimumHeaterPulseMs) {
    pulse_ms = config::kMinimumHeaterPulseMs;
  }
  return pulse_ms;
}

void TemperatureController::reset_heater_control_window(std::uint32_t now_ms) {
  heater_control_window_started_ms_ = now_ms;
}

void TemperatureController::reset_readiness(std::uint32_t now_ms) {
  ready_band_active_ = false;
  ready_band_since_ms_ = now_ms;
}

void TemperatureController::return_to_brew(std::uint32_t now_ms) {
  mode_ = ControlMode::kBrew;
  steam_timeout_active_ = false;
  reset_readiness(now_ms);
  reset_heater_control_window(now_ms);
  heating_demand_active_ = false;
  reset_recovery_heat();
  status_ = ControlStatus::kHeating;
}

bool TemperatureController::validate_readings(std::uint32_t) {
  if (!reading_ok(readings_.brew) ||
      (dual_thermocouples_enabled_ && !reading_ok(readings_.steam))) {
    latch_fault(FaultCode::kSensorFailure);
    return false;
  }

  if (over_temperature(readings_, mode_, dual_thermocouples_enabled_)) {
    latch_fault(FaultCode::kOverTemperature);
    return false;
  }

  return true;
}

bool TemperatureController::update_readiness(std::uint32_t now_ms) {
  if (!active_temperature_in_ready_band()) {
    reset_readiness(now_ms);
    return false;
  }
  if (!ready_band_active_) {
    ready_band_active_ = true;
    ready_band_since_ms_ = now_ms;
  }
  return elapsed(now_ms, ready_band_since_ms_, config::kReadyStabilityMs);
}

bool TemperatureController::update_heater(std::uint32_t now_ms) {
  if (fault_latched_) {
    return heater_.force_off();
  }
  if (!heater_enabled_permission_) {
    reset_heater_control_window(now_ms);
    return heater_.set_enabled(false);
  }
  if (!active_temperature_demands_heat()) {
    reset_heater_control_window(now_ms);
    return heater_.set_enabled(false);
  }

  if (elapsed(now_ms, heater_control_window_started_ms_,
              config::kHeaterControlWindowMs)) {
    reset_heater_control_window(now_ms);
  }
  const auto window_elapsed_ms =
      static_cast<std::uint32_t>(now_ms - heater_control_window_started_ms_);
  return heater_.set_enabled(window_elapsed_ms < heater_pulse_ms());
}

SteamTimeoutSnapshot TemperatureController::steam_timeout_snapshot(
    std::uint32_t now_ms) const {
  if (mode_ != ControlMode::kSteam || !steam_timeout_active_) {
    return {};
  }
  const auto elapsed_ms = static_cast<std::uint32_t>(
      now_ms - steam_timeout_started_ms_);
  if (elapsed_ms >= config::kSteamReadyTimeoutMs) {
    return {true, 0};
  }
  return {true, config::kSteamReadyTimeoutMs - elapsed_ms};
}

}  // namespace philcoino::control
