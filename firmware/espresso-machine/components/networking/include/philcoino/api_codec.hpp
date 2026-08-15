#pragma once

#include <cstdint>
#include <string>

#include "philcoino/api.hpp"

namespace philcoino::networking::codec {

inline constexpr char kMalformedMessage[] =
    "The JSON request body is malformed.";

HttpResponse json_response(int status, std::string body,
                           bool bearer_challenge = false);
HttpResponse error_response(int status, const char* code, const char* message,
                            bool bearer_challenge = false);

const char* mode_name(control::ControlMode mode);
std::string serialize_health(std::uint64_t uptime_ms);
std::string serialize_device(const DeviceIdentity& identity);
std::string serialize_state(const control::ControlSnapshot& snapshot,
                            std::uint64_t uptime_ms);
bool parse_temperatures(const std::string& body,
                        peripherals::TemperatureTargets current,
                        peripherals::TemperatureTargets& updated,
                        bool& constraint_violation);
bool parse_mode(const std::string& body, control::ControlMode& mode);
bool parse_heater_enabled(const std::string& body, bool& enabled);
bool parse_settings(
    const std::string& body,
    peripherals::TemperatureTargets current_targets,
    peripherals::SteamControlSettings current_steam,
    peripherals::TemperatureTargets& updated_targets,
    peripherals::SteamControlSettings& updated_steam,
    bool& has_temperature_settings,
    bool& has_steam_settings,
    bool& constraint_violation);
bool parse_temperature_calibration_query(const std::string& query,
                                         bool& calibration_id_supplied,
                                         std::string& calibration_id);
bool parse_temperature_calibration_candidate(
    const std::string& body, std::string& calibration_id,
    std::int32_t& candidate_raw_target_c);
bool parse_temperature_calibration_session(const std::string& body,
                                           std::string& calibration_id);
std::string serialize_temperature_calibration(
    const control::TemperatureCalibrationSnapshot& snapshot);

bool parse_start(const std::string& body, std::string& idempotency_key,
                 control::ExtractionSelection& selection);
bool parse_start(const std::string& body, std::string& idempotency_key,
                 control::ExtractionSelection& selection,
                 control::WeightControl& weight_control,
                 bool& weighted);
bool parse_scale_calibration_complete(const std::string& body,
                                      std::int32_t& reference_decigrams);
bool parse_cooldown_start(const std::string& body,
                          std::string& idempotency_key);

std::string serialize_extraction(const control::ExtractionSnapshot& snapshot);
std::string serialize_cooldown(const control::CooldownSnapshot& snapshot);
std::string serialize_compensation(
    bool compensation_active,
    const control::ExtractionSnapshot& extraction);
std::string serialize_scale(const control::ScaleSnapshot& scale,
                            const control::WeightExtractionSnapshot& weight);

}  // namespace philcoino::networking::codec
