#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/peripherals.hpp"

namespace philcoino::control {

enum class ControlMode { kBrew, kSteam };
enum class ControlStatus { kHeating, kReady, kFault };

enum class FaultCode {
  kSensorFailure,
  kOverTemperature,
  kHeatingTimeout,
  kInternalError,
};

struct FaultSnapshot {
  FaultCode code{FaultCode::kInternalError};
  const char* message{"Temperature control entered a safe fault state."};
};

struct SteamTimeoutSnapshot {
  bool active{false};
  std::uint32_t remaining_ms{0};
};

struct ControlSnapshot {
  ControlStatus status{ControlStatus::kHeating};
  ControlMode mode{ControlMode::kBrew};
  peripherals::TemperatureTargets targets{};
  peripherals::ThermocoupleReadings readings{};
  bool heater_enabled_permission{true};
  bool heater_enabled{false};
  bool fault_active{false};
  FaultSnapshot fault{};
  SteamTimeoutSnapshot steam_timeout{};
};

const char* fault_code_name(FaultCode code);
const char* fault_message(FaultCode code);

class TemperatureController {
 public:
  TemperatureController(peripherals::TemperatureTargets targets,
                        peripherals::FailOffSsr& heater,
                        bool dual_thermocouples_enabled = true);

  ControlMode mode() const;
  ControlStatus status() const;
  const peripherals::TemperatureTargets& targets() const;
  bool has_fault() const;
  FaultCode fault_code() const;
  bool heater_enabled_permission() const;
  bool heater_enabled() const;

  bool set_mode(ControlMode mode, std::uint32_t now_ms);
  bool set_heater_enabled(bool enabled, std::uint32_t now_ms);
  bool update_targets(const peripherals::TemperatureTargets& targets,
                      peripherals::TargetStorage& storage,
                      std::uint32_t now_ms);
  bool update_brew_target(std::int32_t brew_c,
                          peripherals::TargetStorage& storage,
                          std::uint32_t now_ms);
  bool update_steam_target(std::int32_t steam_c,
                           peripherals::TargetStorage& storage,
                           std::uint32_t now_ms);
  bool dismiss_over_temperature(std::uint32_t now_ms);

  ControlSnapshot update(const peripherals::ThermocoupleReadings& readings,
                         std::uint32_t now_ms);
  ControlSnapshot snapshot(std::uint32_t now_ms) const;
  void latch_fault(FaultCode code);

 private:
  std::int32_t active_target() const;
  float active_temperature() const;
  bool active_temperature_in_ready_band() const;
  bool active_temperature_demands_heat() const;
  bool monitored_readings_ok() const;
  bool active_temperature_back_at_target() const;
  float active_heat_ramp_band() const;
  float active_recovery_trigger_drop() const;
  float active_recovery_heat_ramp_band() const;
  void reset_recovery_heat();
  void update_recovery_heat();
  std::uint32_t heater_pulse_ms() const;
  void reset_heater_control_window(std::uint32_t now_ms);
  void reset_readiness(std::uint32_t now_ms);
  void return_to_brew(std::uint32_t now_ms);
  bool validate_readings(std::uint32_t now_ms);
  bool update_readiness(std::uint32_t now_ms);
  bool update_heater(std::uint32_t now_ms);
  SteamTimeoutSnapshot steam_timeout_snapshot(std::uint32_t now_ms) const;

  peripherals::FailOffSsr& heater_;
  peripherals::TemperatureTargets targets_{};
  peripherals::ThermocoupleReadings readings_{};
  bool dual_thermocouples_enabled_{true};
  ControlMode mode_{ControlMode::kBrew};
  ControlStatus status_{ControlStatus::kHeating};
  FaultCode fault_code_{FaultCode::kInternalError};
  bool heater_enabled_permission_{true};
  bool fault_latched_{false};
  bool ready_band_active_{false};
  std::uint32_t ready_band_since_ms_{0};
  bool heating_demand_active_{false};
  std::uint32_t heating_demand_since_ms_{0};
  std::uint32_t heater_control_window_started_ms_{0};
  bool recovery_heat_armed_{false};
  bool recovery_heat_active_{false};
  bool steam_timeout_active_{false};
  std::uint32_t steam_timeout_started_ms_{0};
};

enum class ExtractionStatus { kIdle, kRunning };
enum class ExtractionPhase { kIdle, kManual, kPreInfusion, kSoak, kMainExtraction };
enum class ExtractionSelectionKind { kManual, kProfile };

struct ExtractionSelection {
  ExtractionSelectionKind kind{ExtractionSelectionKind::kManual};
  std::size_t profile_index{0};
};

struct ExtractionSnapshot {
  ExtractionStatus status{ExtractionStatus::kIdle};
  std::string extraction_id{};
  ExtractionSelection selection{};
  ExtractionPhase phase{ExtractionPhase::kIdle};
  std::uint32_t elapsed_ms{0};
  std::uint32_t remaining_ms{0};
  peripherals::PumpCommand pump_command{peripherals::PumpCommand::kOff};
};

enum class StartExtractionResult {
  kStarted,
  kReplay,
  kConflict,
  kProfileNotConfigured,
  kInvalidRequest,
  kOutputFailure,
};

enum class ReplaceProfilesResult {
  kReplaced,
  kActive,
  kInvalidProfiles,
  kPersistenceFailure,
};

enum class ExtractionUpdateResult { kOk, kCompleted, kOutputFailure };

class ExtractionController {
 public:
  ExtractionController(peripherals::ExtractionProfiles profiles,
                       peripherals::FailOffPump& pump);

  const peripherals::ExtractionProfiles& profiles() const;
  bool active() const;
  ExtractionSnapshot snapshot(std::uint32_t now_ms) const;

  ReplaceProfilesResult replace_profiles(
      const peripherals::ExtractionProfiles& profiles,
      peripherals::ProfileStorage& storage);
  bool adopt_persisted_profiles(
      const peripherals::ExtractionProfiles& profiles);
  StartExtractionResult start(const std::string& idempotency_key,
                              ExtractionSelection selection,
                              std::uint32_t now_ms);
  bool stop();
  ExtractionUpdateResult update(std::uint32_t now_ms);

 private:
  static bool valid_idempotency_key(const std::string& key);
  ExtractionPhase phase_at(std::uint32_t elapsed_ms) const;
  std::uint32_t total_duration_ms() const;
  bool command_for_phase(ExtractionPhase phase);
  void clear_active();

  peripherals::ExtractionProfiles profiles_{};
  peripherals::FailOffPump& pump_;
  bool active_{false};
  std::uint32_t started_at_ms_{0};
  std::uint32_t extraction_counter_{0};
  std::string extraction_id_{};
  std::string idempotency_key_{};
  ExtractionSelection selection_{};
  peripherals::ExtractionProfile active_profile_{};
  ExtractionPhase phase_{ExtractionPhase::kIdle};
};

}  // namespace philcoino::control
