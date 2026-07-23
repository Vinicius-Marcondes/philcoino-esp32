#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/peripherals.hpp"

namespace philcoino::control {

enum class ControlMode { kBrew, kSteam };
enum class ControlStatus { kHeating, kReady, kFault };
enum class ExtractionPhase { kIdle, kManual, kPreInfusion, kSoak, kMainExtraction };

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
  // Valid readings contain the active effective control temperature: raw in
  // Brew and corrected once by the controller in Steam.
  peripherals::ThermocoupleReading boiler_temperature{};
  bool heater_enabled_permission{true};
  bool heater_enabled{false};
  bool fault_active{false};
  FaultSnapshot fault{};
  SteamTimeoutSnapshot steam_timeout{};
};

peripherals::DisplayTemperature display_temperature(
    const ControlSnapshot& snapshot);

const char* fault_code_name(FaultCode code);
const char* fault_message(FaultCode code);

class TemperatureController {
 public:
  TemperatureController(peripherals::TemperatureTargets targets,
                        peripherals::FailOffSsr& heater);

  ControlMode mode() const;
  ControlStatus status() const;
  const peripherals::TemperatureTargets& targets() const;
  bool has_fault() const;
  FaultCode fault_code() const;
  bool heater_enabled_permission() const;
  bool heater_enabled() const;
  bool brew_effective_temperature(float& temperature_c) const;
  bool extraction_compensation_active() const;
  bool cooldown_inhibited() const;
  bool target_update_in_progress() const;

  bool set_mode(ControlMode mode, std::uint32_t now_ms);
  void set_extraction_phase(ExtractionPhase phase, std::uint32_t now_ms);
  bool begin_cooldown_inhibit(std::uint32_t now_ms);
  bool force_cooldown_heater_off();
  bool end_cooldown_inhibit(std::uint32_t now_ms);
  bool set_heater_enabled(bool enabled, std::uint32_t now_ms);
  bool update_targets(const peripherals::TemperatureTargets& targets,
                      peripherals::TargetStorage& storage,
                      std::uint32_t now_ms);
  bool prepare_target_update(
      const peripherals::TemperatureTargets& targets,
      std::uint32_t now_ms);
  bool adopt_persisted_targets(
      const peripherals::TemperatureTargets& targets,
      std::uint32_t now_ms);
  bool rollback_target_update(std::uint32_t now_ms);
  bool update_brew_target(std::int32_t brew_c,
                          peripherals::TargetStorage& storage,
                          std::uint32_t now_ms);
  bool update_steam_target(std::int32_t steam_c,
                           peripherals::TargetStorage& storage,
                           std::uint32_t now_ms);
  bool dismiss_over_temperature(std::uint32_t now_ms);

  ControlSnapshot update(const peripherals::ThermocoupleReading& reading,
                         std::uint32_t now_ms);
  ControlSnapshot snapshot(std::uint32_t now_ms) const;
  void latch_fault(FaultCode code);

 private:
  std::int32_t active_target() const;
  std::int32_t heater_duty_target() const;
  float active_temperature() const;
  bool active_temperature_in_ready_band() const;
  bool active_temperature_demands_heat() const;
  bool boiler_reading_ok() const;
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
  peripherals::ThermocoupleReading raw_boiler_temperature_{};
  ControlMode mode_{ControlMode::kBrew};
  ControlStatus status_{ControlStatus::kHeating};
  FaultCode fault_code_{FaultCode::kInternalError};
  bool heater_enabled_permission_{true};
  ExtractionPhase extraction_phase_{ExtractionPhase::kIdle};
  bool cooldown_inhibited_{false};
  bool target_update_in_progress_{false};
  bool pending_active_target_change_{false};
  peripherals::TemperatureTargets pending_targets_{};
  bool fault_latched_{false};
  bool ready_band_active_{false};
  std::uint32_t ready_band_since_ms_{0};
  bool warmup_deadline_active_{false};
  std::uint32_t warmup_started_ms_{0};
  bool readiness_achieved_{false};
  bool recovery_deadline_active_{false};
  std::uint32_t recovery_started_ms_{0};
  std::uint32_t heater_control_window_started_ms_{0};
  bool recovery_heat_armed_{false};
  bool recovery_heat_active_{false};
  bool steam_timeout_active_{false};
  std::uint32_t steam_timeout_started_ms_{0};
};

enum class ExtractionStatus { kIdle, kRunning };
enum class ExtractionOutcome { kNone, kCompleted, kStopped, kFailed };
enum class ExtractionSelectionKind { kManual, kProfile };

struct ExtractionSelection {
  ExtractionSelectionKind kind{ExtractionSelectionKind::kManual};
  std::size_t profile_index{0};
};

struct WeightControl {
  std::int32_t target_decigrams{0};
  std::int32_t compensation_decigrams{0};
};

bool weight_control_is_valid(const WeightControl& control);

enum class ScaleAvailability { kUnavailable, kUnstable, kReady };
enum class ScaleCalibrationStatus {
  kUncalibrated,
  kCalibrating,
  kCalibrated,
};

struct ScaleSnapshot {
  ScaleAvailability availability{ScaleAvailability::kUnavailable};
  ScaleCalibrationStatus calibration_status{
      ScaleCalibrationStatus::kUncalibrated};
  bool stable{false};
  bool gross_weight_available{false};
  std::int32_t gross_weight_decigrams{0};
};

enum class ScaleCalibrationResult {
  kOk,
  kWorkflowActive,
  kUnavailable,
  kUnstable,
  kNotStarted,
  kInvalidReference,
  kPersistenceFailure,
};

class ScaleController {
 public:
  ScaleController(peripherals::ScaleCalibration calibration,
                  bool calibrated,
                  peripherals::ScaleCalibrationStorage& storage);

  void update(peripherals::Hx711Reading reading, std::uint32_t now_ms);
  ScaleSnapshot snapshot(std::uint32_t now_ms) const;
  ScaleCalibrationResult start_calibration(bool workflow_active,
                                           std::uint32_t now_ms);
  ScaleCalibrationResult complete_calibration(
      std::int32_t reference_decigrams,
      bool workflow_active,
      std::uint32_t now_ms);
  void cancel_calibration();

 private:
  bool available(std::uint32_t now_ms) const;
  bool stable() const;
  std::int32_t median_raw() const;
  std::int32_t stable_raw_spread_limit() const;

  peripherals::ScaleCalibration calibration_{};
  peripherals::ScaleCalibrationStorage& storage_;
  std::array<std::int32_t, 10> samples_{};
  std::size_t sample_count_{0};
  std::size_t sample_index_{0};
  std::uint32_t last_valid_ms_{0};
  bool has_valid_sample_{false};
  bool transport_failed_{false};
  bool calibrated_{false};
  bool calibration_in_progress_{false};
  std::int32_t calibration_zero_raw_{0};
};

struct ExtractionSnapshot {
  ExtractionStatus status{ExtractionStatus::kIdle};
  std::string extraction_id{};
  ExtractionSelection selection{};
  ExtractionPhase phase{ExtractionPhase::kIdle};
  std::uint32_t elapsed_ms{0};
  std::uint32_t remaining_ms{0};
  peripherals::PumpCommand pump_command{peripherals::PumpCommand::kOff};
  ExtractionOutcome outcome{ExtractionOutcome::kNone};
};

enum class StartExtractionResult {
  kStarted,
  kReplay,
  kIdempotencyMismatch,
  kConflict,
  kProfileNotConfigured,
  kInvalidRequest,
  kOutputFailure,
  kScaleNotCalibrated,
  kScaleNotStable,
  kScaleUnavailable,
  kScaleWarningUnacknowledged,
};

enum class ExtractionReplayStatus { kNone, kMatch, kMismatch };

enum class ReplaceProfilesResult {
  kReplaced,
  kActive,
  kInvalidProfiles,
  kPersistenceFailure,
};

enum class ExtractionUpdateResult { kOk, kCompleted, kOutputFailure };

enum class WeightCompletionReason {
  kNone,
  kWeightReached,
  kTimerFallback,
  kStopped,
  kSafetyCutoff,
};

struct WeightExtractionSnapshot {
  bool active{false};
  bool terminal{false};
  std::string extraction_id{};
  WeightControl control{};
  std::int32_t cutoff_decigrams{0};
  bool net_weight_available{false};
  std::int32_t net_weight_decigrams{0};
  bool fallback{false};
  bool settled{false};
  WeightCompletionReason completion_reason{WeightCompletionReason::kNone};
  bool warning_active{false};
};

class ExtractionController {
 public:
  ExtractionController(peripherals::ExtractionProfiles profiles,
                       peripherals::FailOffPump& pump);

  const peripherals::ExtractionProfiles& profiles() const;
  bool active() const;
  ExtractionReplayStatus replay_status(
      const std::string& idempotency_key,
      const ExtractionSelection& selection,
      const WeightControl* weight_control = nullptr) const;
  ExtractionSnapshot snapshot(std::uint32_t now_ms) const;
  WeightExtractionSnapshot weight_snapshot(
      const ScaleSnapshot& scale,
      std::uint32_t now_ms) const;

  ReplaceProfilesResult replace_profiles(
      const peripherals::ExtractionProfiles& profiles,
      peripherals::ProfileStorage& storage);
  bool adopt_persisted_profiles(
      const peripherals::ExtractionProfiles& profiles);
  StartExtractionResult start(const std::string& idempotency_key,
                              ExtractionSelection selection,
                              std::uint32_t now_ms,
                              const WeightControl* weight_control = nullptr,
                              const ScaleSnapshot* scale = nullptr);
  bool stop(std::uint32_t now_ms = 0);
  ExtractionUpdateResult update(std::uint32_t now_ms,
                                const ScaleSnapshot* scale = nullptr);
  void acknowledge_scale_warning();

 private:
  static bool valid_idempotency_key(const std::string& key);
  ExtractionPhase phase_at(std::uint32_t elapsed_ms) const;
  std::uint32_t total_duration_ms() const;
  bool command_for_phase(ExtractionPhase phase);
  void finish(ExtractionOutcome outcome, std::uint32_t elapsed_ms);
  void finish_weighted(ExtractionOutcome outcome,
                       WeightCompletionReason reason,
                       std::uint32_t elapsed_ms,
                       const ScaleSnapshot* scale);
  static bool selections_equal(const ExtractionSelection& left,
                               const ExtractionSelection& right);
  static bool weight_controls_equal(const WeightControl* left,
                                    const WeightControl* right);

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
  ExtractionOutcome outcome_{ExtractionOutcome::kNone};
  std::uint32_t terminal_elapsed_ms_{0};
  bool weighted_{false};
  WeightControl weight_control_{};
  std::int32_t tare_decigrams_{0};
  bool weight_fallback_{false};
  bool scale_warning_active_{false};
  bool terminal_weight_available_{false};
  std::int32_t terminal_weight_decigrams_{0};
  bool terminal_weight_settled_{false};
  bool weight_record_present_{false};
  std::string weight_record_extraction_id_{};
  WeightControl weight_record_control_{};
  std::int32_t weight_record_tare_decigrams_{0};
  bool weight_record_fallback_{false};
  std::uint32_t weight_settling_started_ms_{0};
  WeightCompletionReason weight_completion_reason_{
      WeightCompletionReason::kNone};
};

enum class CooldownStatus { kIdle, kPumping, kStabilizing };
enum class CooldownOutcome { kNone, kTargetReached, kCutoff, kStopped, kFailed };

struct CooldownInput {
  bool sensor_valid{false};
  bool fault_active{false};
  bool extraction_active{false};
  float boiler_temperature_c{0.0F};
};

struct CooldownSnapshot {
  CooldownStatus status{CooldownStatus::kIdle};
  std::string cooldown_id{};
  std::int32_t brew_target_c{0};
  std::uint32_t elapsed_ms{0};
  std::uint32_t remaining_ms{0};
  peripherals::PumpCommand pump_command{peripherals::PumpCommand::kOff};
  bool heater_inhibited{false};
  CooldownOutcome outcome{CooldownOutcome::kNone};
};

enum class StartCooldownResult {
  kStarted,
  kReplay,
  kConflict,
  kInvalidRequest,
  kSensorUnavailable,
  kMachineFault,
  kExtractionActive,
  kNotRequired,
  kOutputFailure,
};

enum class CooldownUpdateResult { kOk, kCompleted, kFailed };

class CooldownController {
 public:
  CooldownController(TemperatureController& temperature,
                     peripherals::FailOffPump& pump);

  CooldownSnapshot snapshot(std::uint32_t now_ms) const;
  bool active() const;
  StartCooldownResult start(const std::string& idempotency_key,
                            const CooldownInput& input,
                            std::uint32_t now_ms);
  CooldownUpdateResult update(const CooldownInput& input,
                              std::uint32_t now_ms);
  CooldownUpdateResult stop(std::uint32_t now_ms);
  bool reset(std::uint32_t now_ms);

 private:
  static bool valid_idempotency_key(const std::string& key);
  CooldownUpdateResult enter_stabilization(CooldownOutcome outcome,
                                            std::uint32_t started_ms,
                                            std::uint32_t now_ms);
  CooldownUpdateResult fail(FaultCode fault, std::uint32_t now_ms);
  CooldownUpdateResult complete(std::uint32_t now_ms);

  TemperatureController& temperature_;
  peripherals::FailOffPump& pump_;
  CooldownStatus status_{CooldownStatus::kIdle};
  CooldownOutcome outcome_{CooldownOutcome::kNone};
  std::uint32_t started_at_ms_{0};
  std::uint32_t stabilization_started_at_ms_{0};
  std::uint32_t terminal_elapsed_ms_{0};
  std::uint32_t cooldown_counter_{0};
  std::int32_t brew_target_c_{0};
  std::string cooldown_id_{};
  std::string idempotency_key_{};
};

}  // namespace philcoino::control
