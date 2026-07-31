#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/brew_pi.hpp"
#include "philcoino/config.hpp"
#include "philcoino/peripherals.hpp"

namespace philcoino::control {

enum class ControlMode { kBrew, kSteam };
enum class ControlStatus { kHeating, kReady, kFault };
enum class ExtractionPhase { kIdle, kManual, kPreInfusion, kSoak, kMainExtraction };
enum class ControllerOperatingMode {
  kWarmup,
  kIdleStable,
  kBrewing,
  kPostBrewRecovery,
  kSteam,
  kInhibited,
  kFault,
};

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

struct SteamControlSnapshot {
  peripherals::SteamControlSettings settings{};
  bool compensation_active{false};
  float applied_compensation_c{0.0F};
  bool control_temperature_available{false};
  float control_temperature_c{0.0F};
  bool heat_soak_active{false};
  std::uint32_t heat_soak_elapsed_ms{0};
};

struct ControllerDiagnostics {
  float temperature_raw_c{0.0F};
  float temperature_filtered_c{0.0F};
  float base_target_c{0.0F};
  float private_target_c{0.0F};
  float error_c{0.0F};
  SelectedController selected_controller{SelectedController::kLegacyCurve};
  float legacy_requested_duty{0.0F};
  float pi_requested_duty{0.0F};
  float proportional_contribution{0.0F};
  float integral_contribution{0.0F};
  float integral_state{0.0F};
  PiSaturation pi_saturation{PiSaturation::kNone};
  bool pi_anti_windup_active{false};
  bool heater_command_active{false};
  float delivered_command_duty_1s{0.0F};
  peripherals::PumpCommand pump_command{peripherals::PumpCommand::kOff};
  ExtractionPhase extraction_phase{ExtractionPhase::kIdle};
  ControllerOperatingMode operating_mode{ControllerOperatingMode::kWarmup};
};

struct ControlSnapshot {
  ControlStatus status{ControlStatus::kHeating};
  ControlMode mode{ControlMode::kBrew};
  peripherals::TemperatureTargets targets{};
  // Valid readings contain the effective control temperature after the one
  // persisted global calibration offset is applied.
  peripherals::ThermocoupleReading boiler_temperature{};
  bool heater_enabled_permission{true};
  bool heater_enabled{false};
  bool fault_active{false};
  FaultSnapshot fault{};
  SteamTimeoutSnapshot steam_timeout{};
  SteamControlSnapshot steam_control{};
  ControllerDiagnostics controller{};
};

enum class TemperatureCalibrationStatus {
  kUncalibrated,
  kCalibrating,
  kCalibrated,
};

struct TemperatureSafeTargetBounds {
  std::int32_t brew_minimum_c{0};
  std::int32_t brew_maximum_c{0};
  std::int32_t steam_minimum_c{0};
  std::int32_t steam_maximum_c{0};
};

struct TemperatureCalibrationSnapshot {
  TemperatureCalibrationStatus status{
      TemperatureCalibrationStatus::kUncalibrated};
  std::int32_t saved_offset_c{0};
  bool temperature_available{false};
  float raw_temperature_c{0.0F};
  float effective_temperature_c{0.0F};
  bool heater_active{false};
  bool ready{false};
  TemperatureSafeTargetBounds safe_target_bounds{};
  std::string calibration_id{};
  std::int32_t candidate_raw_target_c{
      config::kTemperatureCalibrationReferenceC};
  std::int32_t offset_preview_c{0};
  std::uint32_t advisory_stable_ms{0};
  std::uint32_t session_lease_remaining_ms{0};
  TemperatureSafeTargetBounds preview_safe_target_bounds{};
};

enum class TemperatureCalibrationResult {
  kOk,
  kActive,
  kInactive,
  kSessionMismatch,
  kExpired,
  kSensorUnavailable,
  kHeaterDisabled,
  kFault,
  kSteamMode,
  kMutationConflict,
  kUnsafeTarget,
  kOutputFailure,
  kAdoptionPending,
};

const char* fault_code_name(FaultCode code);
const char* fault_message(FaultCode code);
const char* extraction_phase_name(ExtractionPhase phase);
const char* controller_operating_mode_name(ControllerOperatingMode mode);

class TemperatureController {
 public:
  TemperatureController(peripherals::TemperatureTargets targets,
                        peripherals::FailOffSsr& heater,
                        BrewPiConfig pi_configuration =
                            default_brew_pi_config());
  TemperatureController(
      peripherals::TemperatureTargets targets,
      peripherals::TemperatureCalibration calibration,
      peripherals::FailOffSsr& heater,
      BrewPiConfig pi_configuration = default_brew_pi_config());
  TemperatureController(
      peripherals::TemperatureTargets targets,
      peripherals::TemperatureCalibration calibration,
      peripherals::SteamControlSettings steam_control_settings,
      peripherals::FailOffSsr& heater,
      BrewPiConfig pi_configuration = default_brew_pi_config());

  ControlMode mode() const;
  ControlStatus status() const;
  const peripherals::TemperatureTargets& targets() const;
  bool has_fault() const;
  FaultCode fault_code() const;
  bool heater_enabled_permission() const;
  bool heater_enabled() const;
  const peripherals::TemperatureCalibration& temperature_calibration() const;
  const peripherals::SteamControlSettings& steam_control_settings() const;
  SteamControlSnapshot steam_control_snapshot(std::uint32_t now_ms) const;
  bool prepare_steam_control_settings_update(
      const peripherals::SteamControlSettings& settings,
      std::uint32_t now_ms);
  bool adopt_persisted_steam_control_settings(
      const peripherals::SteamControlSettings& settings,
      std::uint32_t now_ms);
  bool rollback_steam_control_settings_update(std::uint32_t now_ms);
  bool raw_temperature(float& temperature_c) const;
  bool brew_effective_temperature(float& temperature_c) const;
  bool targets_reachable(
      const peripherals::TemperatureTargets& targets) const;
  bool temperature_calibration_active() const;
  TemperatureCalibrationResult start_temperature_calibration(
      const std::string& calibration_id, std::uint32_t now_ms);
  TemperatureCalibrationResult renew_temperature_calibration(
      const std::string& calibration_id, std::uint32_t now_ms);
  TemperatureCalibrationResult update_temperature_calibration_candidate(
      const std::string& calibration_id, std::int32_t candidate_raw_target_c,
      std::uint32_t now_ms);
  TemperatureCalibrationResult prepare_temperature_calibration_save(
      const std::string& calibration_id,
      peripherals::TemperatureCalibration& candidate,
      std::uint32_t now_ms);
  TemperatureCalibrationResult adopt_persisted_temperature_calibration(
      const std::string& calibration_id,
      const peripherals::TemperatureCalibration& calibration,
      std::uint32_t now_ms);
  TemperatureCalibrationResult rollback_temperature_calibration_save(
      const std::string& calibration_id, std::uint32_t now_ms);
  TemperatureCalibrationResult cancel_temperature_calibration(
      const std::string& calibration_id, std::uint32_t now_ms);
  void abort_temperature_calibration(std::uint32_t now_ms);
  TemperatureCalibrationSnapshot temperature_calibration_snapshot(
      std::uint32_t now_ms);
  bool extraction_compensation_active() const;
  bool cooldown_inhibited() const;
  bool target_update_in_progress() const;

  bool set_mode(ControlMode mode, std::uint32_t now_ms);
  void set_extraction_phase(ExtractionPhase phase, std::uint32_t now_ms);
  bool begin_cooldown_inhibit(std::uint32_t now_ms);
  bool force_cooldown_heater_off();
  bool end_cooldown_inhibit(std::uint32_t now_ms);
  bool set_heater_enabled(bool enabled, std::uint32_t now_ms);
  bool prepare_target_update(
      const peripherals::TemperatureTargets& targets,
      std::uint32_t now_ms);
  bool adopt_persisted_targets(
      const peripherals::TemperatureTargets& targets,
      std::uint32_t now_ms);
  bool rollback_target_update(std::uint32_t now_ms);
  bool dismiss_over_temperature(std::uint32_t now_ms);

  ControlSnapshot update(const peripherals::ThermocoupleReading& reading,
                         std::uint32_t now_ms);
  ControlSnapshot update(const peripherals::ThermocoupleReading& reading,
                         peripherals::PumpCommand pump_command,
                         std::uint32_t now_ms);
  ControlSnapshot snapshot(std::uint32_t now_ms) const;
  void latch_fault(FaultCode code);

 private:
  std::int32_t active_target() const;
  std::int32_t heater_duty_target() const;
  float active_temperature() const;
  float applied_steam_compensation(std::uint32_t now_ms) const;
  std::int32_t control_target() const;
  float control_temperature() const;
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
  std::uint32_t duty_pulse_ms(float requested_duty) const;
  float baseline_heater_duty() const;
  ControllerOperatingMode controller_operating_mode() const;
  void update_controller_diagnostics(
      peripherals::PumpCommand pump_command, std::uint32_t now_ms,
      bool reset_pi);
  void account_delivered_command(std::uint32_t now_ms);
  void reset_delivered_command_tracking(std::uint32_t now_ms);
  void reset_heater_control_window(std::uint32_t now_ms);
  void reset_readiness(std::uint32_t now_ms);
  void return_to_brew(std::uint32_t now_ms);
  bool expire_temperature_calibration(std::uint32_t now_ms);
  void restore_ordinary_brew_control(std::uint32_t now_ms);
  bool validate_readings(std::uint32_t now_ms);
  bool update_readiness(std::uint32_t now_ms);
  bool update_heater(std::uint32_t now_ms, float requested_duty);
  SteamTimeoutSnapshot steam_timeout_snapshot(std::uint32_t now_ms) const;

  peripherals::FailOffSsr& heater_;
  peripherals::TemperatureTargets targets_{};
  peripherals::TemperatureCalibration temperature_calibration_{};
  peripherals::SteamControlSettings steam_control_settings_{};
  peripherals::SteamControlSettings pending_steam_control_settings_{};
  peripherals::ThermocoupleReading raw_boiler_temperature_{};
  ControlMode mode_{ControlMode::kBrew};
  ControlStatus status_{ControlStatus::kHeating};
  FaultCode fault_code_{FaultCode::kInternalError};
  bool heater_enabled_permission_{true};
  ExtractionPhase extraction_phase_{ExtractionPhase::kIdle};
  bool cooldown_inhibited_{false};
  bool target_update_in_progress_{false};
  bool steam_control_settings_update_in_progress_{false};
  bool pending_active_target_change_{false};
  peripherals::TemperatureTargets pending_targets_{};
  bool temperature_calibration_active_{false};
  bool temperature_calibration_save_in_progress_{false};
  std::string temperature_calibration_id_{};
  std::string expired_temperature_calibration_id_{};
  std::int32_t temperature_calibration_candidate_raw_c_{
      config::kTemperatureCalibrationReferenceC};
  peripherals::TemperatureCalibration
      pending_temperature_calibration_{};
  std::uint32_t temperature_calibration_last_activity_ms_{0};
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
  bool steam_heat_soak_active_{false};
  std::uint32_t steam_heat_soak_started_ms_{0};
  float current_steam_compensation_c_{0.0F};
  bool post_brew_recovery_active_{false};
  std::uint32_t last_pump_running_ms_{0};
  BrewPiController brew_pi_;
  ControllerDiagnostics controller_diagnostics_{};
  float requested_heater_duty_{0.0F};
  bool delivered_tracking_initialized_{false};
  bool last_heater_command_active_{false};
  std::uint32_t delivered_bucket_started_ms_{0};
  std::uint32_t delivered_last_sample_ms_{0};
  std::uint32_t delivered_command_on_ms_{0};
  float delivered_command_duty_1s_{0.0F};
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
  kAdoptionPending,
};

struct ScaleCalibrationTransaction {
  peripherals::ScaleCalibration candidate{};
  std::uint32_t token{0};
};

class ScaleController {
 public:
  ScaleController(peripherals::ScaleCalibration calibration,
                  bool calibrated);

  void update(peripherals::Hx711Reading reading, std::uint32_t now_ms);
  ScaleSnapshot snapshot(std::uint32_t now_ms) const;
  ScaleCalibrationResult start_calibration(bool workflow_active,
                                           std::uint32_t now_ms);
  ScaleCalibrationResult prepare_calibration_completion(
      std::int32_t reference_decigrams,
      bool workflow_active,
      std::uint32_t now_ms,
      ScaleCalibrationTransaction& transaction);
  bool calibration_persistence_failed(std::uint32_t token);
  bool adopt_persisted_calibration(
      const ScaleCalibrationTransaction& transaction);
  void cancel_calibration();

 private:
  bool available(std::uint32_t now_ms) const;
  bool stable() const;
  bool stable_for_calibration() const;
  std::int32_t median_raw() const;
  std::int32_t stable_raw_spread_limit() const;
  void refresh_cached_derived_state();
  static bool calibrations_equal(
      const peripherals::ScaleCalibration& left,
      const peripherals::ScaleCalibration& right);

  peripherals::ScaleCalibration calibration_{};
  std::array<std::int32_t, 10> samples_{};
  std::size_t sample_count_{0};
  std::size_t sample_index_{0};
  std::uint32_t last_valid_ms_{0};
  bool has_valid_sample_{false};
  bool transport_failed_{false};
  bool calibrated_{false};
  bool calibration_in_progress_{false};
  bool calibration_adoption_pending_{false};
  std::int32_t calibration_zero_raw_{0};
  peripherals::ScaleCalibration pending_calibration_{};
  std::uint32_t pending_calibration_token_{0};
  std::uint32_t next_calibration_token_{1};
  std::int32_t cached_median_raw_{0};
  std::int64_t cached_raw_spread_{0};
  bool cached_gross_weight_available_{false};
  std::int32_t cached_gross_weight_decigrams_{0};
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
