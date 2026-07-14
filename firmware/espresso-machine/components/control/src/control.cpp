#include "philcoino/control.hpp"

#include <cmath>
#include <utility>

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

bool over_temperature(float active_temperature_c, ControlMode mode) {
  const auto limit = mode == ControlMode::kBrew
                         ? config::kBrewOverTemperatureC
                         : config::kSteamOverTemperatureC;
  return active_temperature_c >= static_cast<float>(limit);
}

}  // namespace

peripherals::DisplayTemperature display_temperature(
    const ControlSnapshot& snapshot) {
  return {
      snapshot.boiler_temperature.status ==
          peripherals::ThermocoupleStatus::kOk,
      snapshot.boiler_temperature.temperature_c,
  };
}

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
      return "The boiler thermocouple reading is unavailable, invalid, or implausible.";
    case FaultCode::kOverTemperature:
      return "The boiler temperature exceeded the active mode safety limit.";
    case FaultCode::kHeatingTimeout:
      return "The active boiler sensor did not reach readiness in time.";
    case FaultCode::kInternalError:
      return "Temperature control entered a safe fault state.";
  }
  return "Temperature control entered a safe fault state.";
}

TemperatureController::TemperatureController(
    peripherals::TemperatureTargets targets, peripherals::FailOffSsr& heater)
    : heater_(heater), targets_(targets) {
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

bool TemperatureController::extraction_compensation_active() const {
  const bool eligible_phase = extraction_phase_ == ExtractionPhase::kManual ||
                              extraction_phase_ ==
                                  ExtractionPhase::kMainExtraction;
  return mode_ == ControlMode::kBrew && eligible_phase &&
         heater_enabled_permission_ && !fault_latched_ &&
         !heater_.safety_cutoff_tripped();
}

bool TemperatureController::cooldown_inhibited() const {
  return cooldown_inhibited_;
}

void TemperatureController::set_extraction_phase(ExtractionPhase phase,
                                                 std::uint32_t now_ms) {
  if (extraction_phase_ == phase) {
    return;
  }
  extraction_phase_ = phase;
  reset_heater_control_window(now_ms);
}

bool TemperatureController::begin_cooldown_inhibit(std::uint32_t now_ms) {
  if (mode_ != ControlMode::kBrew && !set_mode(ControlMode::kBrew, now_ms)) {
    cooldown_inhibited_ = true;
    return false;
  }
  cooldown_inhibited_ = true;
  reset_heater_control_window(now_ms);
  if (!heater_.force_off()) {
    latch_fault(FaultCode::kInternalError);
    return false;
  }
  return true;
}

bool TemperatureController::force_cooldown_heater_off() {
  if (heater_.force_off()) {
    return true;
  }
  latch_fault(FaultCode::kInternalError);
  return false;
}

bool TemperatureController::end_cooldown_inhibit(std::uint32_t now_ms) {
  const bool forced_off = heater_.force_off();
  if (!forced_off) {
    latch_fault(FaultCode::kInternalError);
  }
  cooldown_inhibited_ = false;
  reset_heater_control_window(now_ms);
  return forced_off;
}

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
      !boiler_reading_ok() || !active_temperature_back_at_target() ||
      over_temperature(active_temperature(), mode_)) {
    return false;
  }
  fault_latched_ = false;
  reset_readiness(now_ms);
  reset_heater_control_window(now_ms);
  heating_demand_active_ = false;
  reset_recovery_heat();
  return !update(raw_boiler_temperature_, now_ms).fault_active;
}

ControlSnapshot TemperatureController::update(
    const peripherals::ThermocoupleReading& reading, std::uint32_t now_ms) {
  raw_boiler_temperature_ = reading;

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
  value.boiler_temperature = raw_boiler_temperature_;
  if (boiler_reading_ok()) {
    value.boiler_temperature.temperature_c = active_temperature();
  }
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

std::int32_t TemperatureController::heater_duty_target() const {
  if (mode_ != ControlMode::kBrew) {
    return active_target();
  }

  std::int32_t offset_c = 0;
  if (extraction_phase_ == ExtractionPhase::kPreInfusion) {
    offset_c = config::kPreInfusionHeaterDutyOffsetC;
  } else if (extraction_phase_ == ExtractionPhase::kManual ||
             extraction_phase_ == ExtractionPhase::kMainExtraction) {
    offset_c = config::kExtractionHeaterDutyOffsetC;
  }
  const auto compensated_target = targets_.brew_c + offset_c;
  const auto maximum_duty_target = config::kBrewOverTemperatureC - 1;
  return compensated_target < maximum_duty_target ? compensated_target
                                                   : maximum_duty_target;
}

float TemperatureController::active_temperature() const {
  const float raw_temperature_c = raw_boiler_temperature_.temperature_c;
  return mode_ == ControlMode::kSteam
             ? raw_temperature_c +
                   static_cast<float>(config::kSteamTemperatureOffsetC)
             : raw_temperature_c;
}

bool TemperatureController::active_temperature_in_ready_band() const {
  return std::fabs(active_temperature() - static_cast<float>(active_target())) <=
         static_cast<float>(config::kReadyBandC);
}

bool TemperatureController::active_temperature_demands_heat() const {
  return active_temperature() < static_cast<float>(active_target());
}

bool TemperatureController::boiler_reading_ok() const {
  return reading_ok(raw_boiler_temperature_);
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
      static_cast<float>(heater_duty_target()) - active_temperature();
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
  if (!boiler_reading_ok()) {
    latch_fault(FaultCode::kSensorFailure);
    return false;
  }

  if (over_temperature(active_temperature(), mode_)) {
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
  if (cooldown_inhibited_) {
    reset_heater_control_window(now_ms);
    return heater_.set_enabled(false);
  }
  if (!heater_enabled_permission_) {
    reset_heater_control_window(now_ms);
    return heater_.set_enabled(false);
  }
  if (active_temperature() >= static_cast<float>(heater_duty_target())) {
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

ExtractionController::ExtractionController(
    peripherals::ExtractionProfiles profiles, peripherals::FailOffPump& pump)
    : profiles_(std::move(profiles)), pump_(pump) {
  if (!peripherals::extraction_profiles_are_valid(profiles_)) {
    profiles_ = peripherals::default_extraction_profiles();
  }
  pump_.force_off();
}

const peripherals::ExtractionProfiles& ExtractionController::profiles() const {
  return profiles_;
}

bool ExtractionController::active() const { return active_; }

ExtractionSnapshot ExtractionController::snapshot(std::uint32_t now_ms) const {
  if (!active_) {
    return {};
  }

  const auto total_ms = total_duration_ms();
  const auto raw_elapsed_ms = static_cast<std::uint32_t>(now_ms - started_at_ms_);
  const auto elapsed_ms = raw_elapsed_ms < total_ms ? raw_elapsed_ms : total_ms;
  return {
      ExtractionStatus::kRunning,
      extraction_id_,
      selection_,
      phase_at(elapsed_ms),
      elapsed_ms,
      total_ms - elapsed_ms,
      pump_.command(),
  };
}

ReplaceProfilesResult ExtractionController::replace_profiles(
    const peripherals::ExtractionProfiles& profiles,
    peripherals::ProfileStorage& storage) {
  if (active_) {
    return ReplaceProfilesResult::kActive;
  }
  if (!peripherals::extraction_profiles_are_valid(profiles)) {
    return ReplaceProfilesResult::kInvalidProfiles;
  }
  if (!storage.save(profiles)) {
    return ReplaceProfilesResult::kPersistenceFailure;
  }
  profiles_ = profiles;
  return ReplaceProfilesResult::kReplaced;
}

bool ExtractionController::adopt_persisted_profiles(
    const peripherals::ExtractionProfiles& profiles) {
  if (active_ || !peripherals::extraction_profiles_are_valid(profiles)) {
    return false;
  }
  profiles_ = profiles;
  return true;
}

StartExtractionResult ExtractionController::start(
    const std::string& idempotency_key, ExtractionSelection selection,
    std::uint32_t now_ms) {
  if (!valid_idempotency_key(idempotency_key) ||
      (selection.kind == ExtractionSelectionKind::kProfile &&
       selection.profile_index >= profiles_.size())) {
    return StartExtractionResult::kInvalidRequest;
  }
  if (active_) {
    return idempotency_key == idempotency_key_
               ? StartExtractionResult::kReplay
               : StartExtractionResult::kConflict;
  }

  peripherals::ExtractionProfile selected_profile{};
  if (selection.kind == ExtractionSelectionKind::kProfile) {
    selected_profile = profiles_[selection.profile_index];
    if (!selected_profile.configured) {
      return StartExtractionResult::kProfileNotConfigured;
    }
  }

  selection_ = selection;
  active_profile_ = selected_profile;
  started_at_ms_ = now_ms;
  idempotency_key_ = idempotency_key;
  ++extraction_counter_;
  extraction_id_ = "run-" + std::to_string(extraction_counter_);
  phase_ = phase_at(0);
  active_ = true;
  if (!command_for_phase(phase_)) {
    clear_active();
    pump_.force_off();
    return StartExtractionResult::kOutputFailure;
  }
  return StartExtractionResult::kStarted;
}

bool ExtractionController::stop() {
  clear_active();
  return pump_.force_off();
}

ExtractionUpdateResult ExtractionController::update(std::uint32_t now_ms) {
  if (!active_) {
    return pump_.command() == peripherals::PumpCommand::kOff || pump_.force_off()
               ? ExtractionUpdateResult::kOk
               : ExtractionUpdateResult::kOutputFailure;
  }

  const auto elapsed_ms = static_cast<std::uint32_t>(now_ms - started_at_ms_);
  if (elapsed_ms >= total_duration_ms()) {
    clear_active();
    return pump_.force_off() ? ExtractionUpdateResult::kCompleted
                             : ExtractionUpdateResult::kOutputFailure;
  }

  const auto next_phase = phase_at(elapsed_ms);
  if (next_phase != phase_ && !command_for_phase(next_phase)) {
    clear_active();
    pump_.force_off();
    return ExtractionUpdateResult::kOutputFailure;
  }
  phase_ = next_phase;
  return ExtractionUpdateResult::kOk;
}

bool ExtractionController::valid_idempotency_key(const std::string& key) {
  if (key.size() < 16U || key.size() > 64U) {
    return false;
  }
  for (std::size_t index = 0; index < key.size(); ++index) {
    const char value = key[index];
    const bool alphanumeric = (value >= 'A' && value <= 'Z') ||
                              (value >= 'a' && value <= 'z') ||
                              (value >= '0' && value <= '9');
    if (!alphanumeric && (index == 0U || (value != '.' && value != '_' &&
                                          value != '~' && value != '-'))) {
      return false;
    }
  }
  return true;
}

ExtractionPhase ExtractionController::phase_at(std::uint32_t elapsed_ms) const {
  if (selection_.kind == ExtractionSelectionKind::kManual) {
    return ExtractionPhase::kManual;
  }
  const auto pre_infusion_ms =
      static_cast<std::uint32_t>(active_profile_.pre_infusion_seconds) * 1000U;
  const auto soak_end_ms =
      pre_infusion_ms +
      static_cast<std::uint32_t>(active_profile_.soak_seconds) * 1000U;
  if (elapsed_ms < pre_infusion_ms) {
    return ExtractionPhase::kPreInfusion;
  }
  if (elapsed_ms < soak_end_ms) {
    return ExtractionPhase::kSoak;
  }
  return ExtractionPhase::kMainExtraction;
}

std::uint32_t ExtractionController::total_duration_ms() const {
  if (selection_.kind == ExtractionSelectionKind::kManual) {
    return static_cast<std::uint32_t>(
               peripherals::kMaximumExtractionDurationSeconds) *
           1000U;
  }
  return (static_cast<std::uint32_t>(active_profile_.pre_infusion_seconds) +
          static_cast<std::uint32_t>(active_profile_.soak_seconds) +
          static_cast<std::uint32_t>(active_profile_.main_extraction_seconds)) *
         1000U;
}

bool ExtractionController::command_for_phase(ExtractionPhase phase) {
  return pump_.set_running(phase == ExtractionPhase::kManual ||
                           phase == ExtractionPhase::kPreInfusion ||
                           phase == ExtractionPhase::kMainExtraction);
}

void ExtractionController::clear_active() {
  active_ = false;
  started_at_ms_ = 0;
  extraction_id_.clear();
  idempotency_key_.clear();
  selection_ = {};
  active_profile_ = {};
  phase_ = ExtractionPhase::kIdle;
}

CooldownController::CooldownController(TemperatureController& temperature,
                                       peripherals::FailOffPump& pump)
    : temperature_(temperature), pump_(pump) {}

bool CooldownController::active() const {
  return status_ != CooldownStatus::kIdle;
}

CooldownSnapshot CooldownController::snapshot(std::uint32_t now_ms) const {
  CooldownSnapshot value{};
  value.status = status_;
  value.cooldown_id = cooldown_id_;
  value.brew_target_c = brew_target_c_;
  value.pump_command = pump_.command();
  value.heater_inhibited = temperature_.cooldown_inhibited();
  value.outcome = outcome_;
  if (cooldown_id_.empty()) {
    return value;
  }
  if (status_ == CooldownStatus::kIdle) {
    value.elapsed_ms = terminal_elapsed_ms_;
    return value;
  }

  value.elapsed_ms = static_cast<std::uint32_t>(now_ms - started_at_ms_);
  if (status_ == CooldownStatus::kPumping) {
    if (value.elapsed_ms > config::kCooldownPumpLimitMs) {
      value.elapsed_ms = config::kCooldownPumpLimitMs;
    }
    value.remaining_ms = config::kCooldownPumpLimitMs - value.elapsed_ms;
    return value;
  }

  const auto stabilization_elapsed =
      static_cast<std::uint32_t>(now_ms - stabilization_started_at_ms_);
  value.remaining_ms = stabilization_elapsed >= config::kCooldownStabilizationMs
                           ? 0U
                           : config::kCooldownStabilizationMs -
                                 stabilization_elapsed;
  return value;
}

StartCooldownResult CooldownController::start(
    const std::string& idempotency_key, const CooldownInput& input,
    std::uint32_t now_ms) {
  if (!valid_idempotency_key(idempotency_key)) {
    return StartCooldownResult::kInvalidRequest;
  }
  if (!idempotency_key_.empty() && idempotency_key == idempotency_key_) {
    return StartCooldownResult::kReplay;
  }
  if (active()) {
    return StartCooldownResult::kConflict;
  }
  if (!input.sensor_valid || !std::isfinite(input.boiler_temperature_c)) {
    return StartCooldownResult::kSensorUnavailable;
  }
  if (input.fault_active || temperature_.has_fault()) {
    return StartCooldownResult::kMachineFault;
  }
  if (input.extraction_active) {
    return StartCooldownResult::kExtractionActive;
  }
  const auto target = temperature_.targets().brew_c;
  if (input.boiler_temperature_c <= static_cast<float>(target)) {
    return StartCooldownResult::kNotRequired;
  }

  started_at_ms_ = now_ms;
  stabilization_started_at_ms_ = 0;
  terminal_elapsed_ms_ = 0;
  brew_target_c_ = target;
  idempotency_key_ = idempotency_key;
  ++cooldown_counter_;
  cooldown_id_ = "cooldown-" + std::to_string(cooldown_counter_);
  outcome_ = CooldownOutcome::kNone;
  status_ = CooldownStatus::kPumping;

  if (!temperature_.begin_cooldown_inhibit(now_ms) ||
      !pump_.set_running(true)) {
    fail(FaultCode::kInternalError, now_ms);
    return StartCooldownResult::kOutputFailure;
  }
  return StartCooldownResult::kStarted;
}

CooldownUpdateResult CooldownController::update(const CooldownInput& input,
                                                std::uint32_t now_ms) {
  if (!active()) {
    return pump_.command() == peripherals::PumpCommand::kOff || pump_.force_off()
               ? CooldownUpdateResult::kOk
               : CooldownUpdateResult::kFailed;
  }
  if (!input.sensor_valid || !std::isfinite(input.boiler_temperature_c)) {
    return fail(FaultCode::kSensorFailure, now_ms);
  }
  if (input.fault_active || temperature_.has_fault()) {
    const auto fault = temperature_.has_fault() ? temperature_.fault_code()
                                                 : FaultCode::kInternalError;
    return fail(fault, now_ms);
  }
  if (!temperature_.force_cooldown_heater_off()) {
    return fail(FaultCode::kInternalError, now_ms);
  }

  if (status_ == CooldownStatus::kPumping) {
    if (pump_.command() != peripherals::PumpCommand::kRunning) {
      return fail(FaultCode::kInternalError, now_ms);
    }
    if (input.boiler_temperature_c <= static_cast<float>(brew_target_c_)) {
      return enter_stabilization(CooldownOutcome::kTargetReached, now_ms,
                                 now_ms);
    }
    if (elapsed(now_ms, started_at_ms_, config::kCooldownPumpLimitMs)) {
      return enter_stabilization(
          CooldownOutcome::kCutoff,
          started_at_ms_ + config::kCooldownPumpLimitMs, now_ms);
    }
    return CooldownUpdateResult::kOk;
  }

  if (pump_.command() != peripherals::PumpCommand::kOff && !pump_.force_off()) {
    return fail(FaultCode::kInternalError, now_ms);
  }
  if (elapsed(now_ms, stabilization_started_at_ms_,
              config::kCooldownStabilizationMs)) {
    return complete(now_ms);
  }
  return CooldownUpdateResult::kOk;
}

CooldownUpdateResult CooldownController::stop(std::uint32_t now_ms) {
  if (status_ == CooldownStatus::kIdle) {
    return pump_.command() == peripherals::PumpCommand::kOff || pump_.force_off()
               ? CooldownUpdateResult::kOk
               : CooldownUpdateResult::kFailed;
  }
  if (status_ == CooldownStatus::kStabilizing) {
    return update({true, temperature_.has_fault(), false,
                   static_cast<float>(brew_target_c_) + 1.0F},
                  now_ms);
  }
  return enter_stabilization(CooldownOutcome::kStopped, now_ms, now_ms);
}

bool CooldownController::reset(std::uint32_t now_ms) {
  const bool pump_off = pump_.force_off();
  const bool heater_off = temperature_.end_cooldown_inhibit(now_ms);
  if (!pump_off) {
    temperature_.latch_fault(FaultCode::kInternalError);
  }
  status_ = CooldownStatus::kIdle;
  outcome_ = CooldownOutcome::kNone;
  started_at_ms_ = 0;
  stabilization_started_at_ms_ = 0;
  terminal_elapsed_ms_ = 0;
  brew_target_c_ = 0;
  cooldown_id_.clear();
  idempotency_key_.clear();
  return pump_off && heater_off;
}

bool CooldownController::valid_idempotency_key(const std::string& key) {
  if (key.size() < 16U || key.size() > 64U) {
    return false;
  }
  for (std::size_t index = 0; index < key.size(); ++index) {
    const char value = key[index];
    const bool alphanumeric = (value >= 'A' && value <= 'Z') ||
                              (value >= 'a' && value <= 'z') ||
                              (value >= '0' && value <= '9');
    if (!alphanumeric &&
        (index == 0U ||
         (value != '.' && value != '_' && value != '~' && value != '-'))) {
      return false;
    }
  }
  return true;
}

CooldownUpdateResult CooldownController::enter_stabilization(
    CooldownOutcome outcome, std::uint32_t started_ms, std::uint32_t now_ms) {
  const bool pump_off = pump_.force_off();
  const bool heater_off = temperature_.force_cooldown_heater_off();
  if (!pump_off || !heater_off) {
    return fail(FaultCode::kInternalError, now_ms);
  }
  status_ = CooldownStatus::kStabilizing;
  outcome_ = outcome;
  stabilization_started_at_ms_ = started_ms;
  if (elapsed(now_ms, stabilization_started_at_ms_,
              config::kCooldownStabilizationMs)) {
    return complete(now_ms);
  }
  return CooldownUpdateResult::kOk;
}

CooldownUpdateResult CooldownController::fail(FaultCode fault,
                                              std::uint32_t now_ms) {
  temperature_.latch_fault(fault);
  pump_.force_off();
  temperature_.end_cooldown_inhibit(now_ms);
  status_ = CooldownStatus::kIdle;
  outcome_ = CooldownOutcome::kFailed;
  terminal_elapsed_ms_ =
      cooldown_id_.empty() ? 0U
                           : static_cast<std::uint32_t>(now_ms - started_at_ms_);
  return CooldownUpdateResult::kFailed;
}

CooldownUpdateResult CooldownController::complete(std::uint32_t now_ms) {
  const bool pump_off = pump_.force_off();
  const bool heater_off = temperature_.end_cooldown_inhibit(now_ms);
  terminal_elapsed_ms_ = static_cast<std::uint32_t>(now_ms - started_at_ms_);
  status_ = CooldownStatus::kIdle;
  if (!pump_off || !heater_off) {
    temperature_.latch_fault(FaultCode::kInternalError);
    outcome_ = CooldownOutcome::kFailed;
    return CooldownUpdateResult::kFailed;
  }
  return CooldownUpdateResult::kCompleted;
}

}  // namespace philcoino::control
