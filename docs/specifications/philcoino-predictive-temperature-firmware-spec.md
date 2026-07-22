# PhilcoINO Predictive Temperature Control
## Firmware Specification

**Document status:** Prototype specification  
**Target platform:** ESP32-C3 / PhilcoINO firmware  
**Initial scope:** Boiler temperature control without scale data  
**Future scope:** Add beverage weight and flow-rate inputs without replacing the temperature predictor

---

## 1. Purpose

Implement a lightweight predictive temperature routine in the ESP32 firmware to reduce temperature overshoot caused by heater and boiler thermal inertia.

The predictor does not replace the existing PID controller. It estimates where the measured temperature is heading and reduces or disables heater output before the boiler sensor reaches the target.

The model coefficients are generated offline by the PhilcoINO desktop analysis tool and exported to the firmware as a configuration file or C++ header.

---

## 2. Problem Statement

The current controller reacts primarily to the current measured temperature. When the heater has already delivered substantial energy, the temperature may continue rising after the heater is switched off.

Observed behavior in the initial PhilcoINO log includes post-extraction peaks approximately 5.5–6.5°C above the configured target. The intended controller should account for:

- Current boiler temperature.
- Temperature rate of change.
- Recent heater activity.
- Recent pump activity.
- Current target temperature.
- Thermal energy that is still moving toward the sensor after heater shutdown.

---

## 3. Goals

The first prototype should:

1. Reduce post-heating and post-extraction overshoot.
2. Preserve the existing PID as the primary controller.
3. Require only a small number of arithmetic operations.
4. Support coefficients generated on a computer.
5. Fall back safely to normal PID behavior if the predictive model is invalid.
6. Log enough information to retrain and validate the predictor later.
7. Allow scale and flow-rate features to be added in a future model version.

---

## 4. Non-Goals

The first prototype will not:

- Replace the PID controller with a neural network.
- Learn or modify coefficients directly on the ESP32.
- Automatically flash new firmware.
- Guarantee puck-level water temperature from boiler-sensor temperature.
- Control extraction yield or stop the pump by beverage weight.
- Use scale, pressure, or flow data.

---

## 5. Control Architecture

The recommended architecture is:

```text
Temperature sensor
       |
       v
Filtering and feature calculation
       |
       +--------------------+
       |                    |
       v                    v
Existing PID        Temperature predictor
       |                    |
       +---------+----------+
                 |
                 v
        Predictive correction
                 |
                 v
         SSR duty command
```

The PID computes the normal heater request. The predictor computes future temperatures and an overshoot risk. The predictive correction may only reduce the PID heater request; it must not increase the heater output in the first prototype.

This constraint makes the predictor a conservative safety and stability layer.

---

## 6. Required Inputs

The firmware shall calculate or receive the following values every control cycle.

| Input | Symbol | Unit | Required |
|---|---:|---:|---|
| Filtered boiler temperature | `T` | °C | Yes |
| Target temperature | `T_target` | °C | Yes |
| Temperature slope | `dT_dt` | °C/s | Yes |
| Temperature acceleration | `d2T_dt2` | °C/s² | Optional |
| Current PID output | `u_pid` | 0–1 | Yes |
| Current heater state/duty | `u_heater` | 0–1 | Yes |
| Pump state | `pump` | 0 or 1 | Yes |
| Recent heater energy, 5 s | `heat_5s` | duty-seconds | Yes |
| Recent heater energy, 15 s | `heat_15s` | duty-seconds | Yes |
| Recent heater energy, 30 s | `heat_30s` | duty-seconds | Recommended |
| Recent pump activity, 5 s | `pump_5s` | seconds | Yes |
| Recent pump activity, 15 s | `pump_15s` | seconds | Recommended |
| Time since heater stopped | `heater_off_age` | seconds | Recommended |
| Time since pump started | `pump_age` | seconds | Recommended |
| Controller mode | `mode` | enum | Yes |

Suggested controller modes:

```text
WARMUP
IDLE_STABLE
BREWING
POST_BREW_RECOVERY
FAULT
```

---

## 7. Sensor Filtering

The predictor must use a filtered temperature, while the raw value remains available for diagnostics.

Recommended first implementation:

```cpp
T_filtered = alpha * T_raw + (1.0f - alpha) * T_filtered_previous;
```

Initial value:

```text
alpha = 0.20 to 0.35
```

The exact value should be treated as a tunable firmware parameter. Filtering must not be so strong that it hides the start of a rapid rise or pump-related drop.

---

## 8. Temperature Slope

Calculate the slope using a short historical window rather than a single-sample difference.

Recommended prototype:

```text
dT_dt = (T_filtered_now - T_filtered_3_seconds_ago) / 3
```

A small least-squares fit over the last 3–5 seconds is preferable if implementation complexity remains low.

Optional acceleration:

```text
d2T_dt2 = (dT_dt_now - dT_dt_3_seconds_ago) / 3
```

Acceleration should be omitted from the first deployed model if it is too noisy or does not improve validation results.

---

## 9. Recent Heater and Pump Features

Maintain rolling histories at the firmware control interval.

For a one-second feature update:

```text
heat_5s  = sum(heater_duty over previous 5 seconds)
heat_15s = sum(heater_duty over previous 15 seconds)
heat_30s = sum(heater_duty over previous 30 seconds)

pump_5s  = sum(pump state over previous 5 seconds)
pump_15s = sum(pump state over previous 15 seconds)
```

If the heater uses time-proportional SSR control, `heater_duty` must represent the requested or delivered duty ratio, not only a Boolean sample at the logging instant.

---

## 10. Prediction Formula

### 10.1 Model Form

Use a separate linear regression for each prediction horizon.

Initial horizons:

```text
5 seconds
10 seconds
20 seconds
```

For each horizon `h`:

```text
T_pred_h =
    b0_h
  + bT_h       * T
  + bTarget_h  * T_target
  + bError_h   * (T_target - T)
  + bSlope_h   * dT_dt
  + bHeat5_h   * heat_5s
  + bHeat15_h  * heat_15s
  + bHeat30_h  * heat_30s
  + bPump5_h   * pump_5s
  + bPump15_h  * pump_15s
  + bPid_h     * u_pid
  + bMode_h    * mode_feature
```

The desktop tool may remove coefficients that do not improve out-of-sample performance.

The predicted peak is:

```text
T_pred_peak = max(T_pred_5, T_pred_10, T_pred_20)
```

The first prototype should use linear or ridge-regression coefficients because they are:

- Fast to calculate.
- Easy to inspect.
- Easy to export.
- Easy to reproduce in C++.
- Less likely to overfit the small initial dataset.

### 10.2 Feature Scaling

Two supported export formats are acceptable.

**Option A — Raw coefficients**

The desktop tool trains directly on values in firmware units and exports raw coefficients.

**Option B — Standardized coefficients**

For each input:

```text
x_scaled = (x - mean_x) / scale_x
```

The export must include every mean and scale value.

Option A is simpler. Option B may improve numerical conditioning. ESP32 floating-point arithmetic is sufficient for either.

---

## 11. Predictive Heater Correction

The predictor shall modify the PID output only when all model validity checks pass.

Definitions:

```text
overshoot_risk = T_pred_peak - T_target
```

Recommended correction:

```text
if overshoot_risk <= prediction_deadband:
    u_command = u_pid
else:
    correction = K_prediction * overshoot_risk
    u_command = clamp(u_pid - correction, 0, 1)
```

Recommended initial parameters:

```text
prediction_deadband = 0.2°C
K_prediction = 0.25 to 0.50 duty/°C
```

A stronger hard cutoff may be applied:

```text
if T_pred_peak >= T_target + hard_cutoff_margin:
    u_command = 0
```

Initial value:

```text
hard_cutoff_margin = 0.3°C
```

The values above are starting points only. The desktop optimizer shall tune them.

---

## 12. Operating Rules

### 12.1 Warm-Up

During cold warm-up:

- Use normal PID behavior until the temperature enters a configurable activation band.
- Enable prediction when `T >= T_target - activation_band`.

Recommended initial value:

```text
activation_band = 8°C
```

This avoids unnecessarily slowing the early warm-up phase.

### 12.2 Stable Idle

Use the predictive correction normally.

### 12.3 Brewing

During pump activity:

- Continue predicting temperature.
- Allow a mode-specific coefficient set if the dataset supports it.
- Do not assume the instantaneous temperature drop means unlimited heater output is safe.
- Prefer recent heater-energy and pump-history features over aggressive PID reaction.

The first prototype may use a single coefficient set for all modes. A later version may export separate `IDLE` and `BREWING/RECOVERY` models.

### 12.4 Post-Brew Recovery

Keep prediction active until:

- The pump has been off for at least 30–60 seconds, and
- The temperature is within the stable band, and
- The absolute slope is below a configurable threshold.

### 12.5 Fault Mode

Disable predictive control and heater output when any existing thermal or sensor safety fault is active.

---

## 13. Safety and Fallback Requirements

The firmware shall ignore the predictive model and use the existing safe control path when any of these conditions occur:

- Model version or checksum is invalid.
- Any coefficient is non-finite.
- Sensor reading is invalid.
- Temperature slope is outside a physically plausible range.
- Timestamp or sample interval is invalid.
- Model input is outside configured training bounds.
- Prediction is non-finite.
- Prediction differs from current temperature by more than a sanity threshold.
- Controller is in a fault state.

Recommended sanity checks:

```text
-10°C <= dT_dt <= +10°C/s
0°C <= T_pred_h <= 160°C
abs(T_pred_h - T) <= 30°C
```

The existing independent maximum-temperature cutoff must remain active and must not depend on the predictor.

---

## 14. Model Configuration Format

The desktop tool shall generate a versioned configuration.

Recommended generated C++ structure:

```cpp
struct LinearHorizonModel {
    float intercept;
    float coefficients[FEATURE_COUNT];
};

struct TempPredictionConfig {
    uint32_t model_version;
    uint32_t feature_schema_version;
    uint32_t training_data_hash;
    float prediction_deadband;
    float prediction_gain;
    float hard_cutoff_margin;
    float activation_band;
    LinearHorizonModel horizon_5s;
    LinearHorizonModel horizon_10s;
    LinearHorizonModel horizon_20s;
};
```

Recommended generated file:

```text
generated/temp_prediction_model.h
```

The generated header should include:

- Creation timestamp.
- Training dataset identifiers.
- Feature order.
- Model metrics.
- Valid input ranges.
- Coefficients.
- Controller correction parameters.
- Checksum or build-time identifier.

---

## 15. Required Logging

The firmware shall log at least the following fields:

```text
timestamp
temperature_raw
temperature_filtered
target_temperature
temperature_slope
temperature_acceleration
pid_output
heater_command
heater_actual
pump_active
heat_5s
heat_15s
heat_30s
pump_5s
pump_15s
predicted_temp_5s
predicted_temp_10s
predicted_temp_20s
predicted_peak
prediction_correction
controller_mode
model_version
fault_code
```

A 1 Hz export is acceptable for initial analysis. A 2–4 Hz internal log is preferable if storage permits.

The actual heater duty delivered during each SSR window is more valuable than a Boolean `heater_active` field.

---

## 16. Firmware Pseudocode

```cpp
void controlTick(float dtSeconds) {
    SensorState sensor = readAndFilterTemperature(dtSeconds);
    HistoryFeatures history = updateHistories(dtSeconds);
    float pidOutput = pid.compute(sensor.filteredTemp, targetTemp);

    float heaterCommand = pidOutput;

    if (predictionModelIsUsable(sensor, history)) {
        FeatureVector x = buildFeatureVector(
            sensor,
            history,
            pidOutput,
            pumpActive,
            controllerMode,
            targetTemp
        );

        float pred5 = predict(model.horizon5, x);
        float pred10 = predict(model.horizon10, x);
        float pred20 = predict(model.horizon20, x);
        float predPeak = max(pred5, max(pred10, pred20));

        if (sensor.filteredTemp >= targetTemp - model.activationBand) {
            float risk = predPeak - targetTemp;

            if (risk > model.predictionDeadband) {
                heaterCommand -= model.predictionGain * risk;
            }

            if (predPeak >= targetTemp + model.hardCutoffMargin) {
                heaterCommand = 0.0f;
            }
        }
    }

    heaterCommand = clamp(heaterCommand, 0.0f, 1.0f);
    heaterCommand = applySafetyLimits(heaterCommand);
    setHeaterDuty(heaterCommand);
    writeControlLog();
}
```

---

## 17. Acceptance Criteria

The first prototype is acceptable when:

1. It compiles and runs on the target ESP32 without timing problems.
2. Disabling prediction produces behavior identical to the current PID.
3. Invalid model data causes a clean fallback.
4. All predictions and corrections appear in exported logs.
5. No prediction can bypass the existing thermal cutoff.
6. On held-out logged sessions, prediction reduces expected overshoot without materially increasing undershoot or recovery time.
7. In controlled machine tests, median peak overshoot improves relative to the current firmware.
8. Heater switching frequency remains within SSR and control-window limits.

Suggested initial target:

```text
Reduce median overshoot by at least 30%
without increasing recovery time by more than 20%
```

---

## 18. Future Scale Integration

The feature schema must reserve a later version for:

```text
beverage_weight_g
weight_rate_g_s
smoothed_flow_rate_g_s
target_beverage_weight_g
estimated_seconds_to_target_weight
pump_pressure_or_power
```

The temperature predictor should remain usable when scale data is absent.

A future model may use flow rate to improve pump-related cooling estimates:

```text
pump cooling effect ≈ function(flow_rate, pump_duration, current_temperature)
```

Scale integration requires a new `feature_schema_version` and retraining. Existing firmware must reject incompatible model schemas rather than silently using incorrect feature ordering.

---

## 19. Recommended Prototype Sequence

1. Add improved logging fields.
2. Implement filtered temperature and slope.
3. Implement rolling heater and pump histories.
4. Deploy prediction code with correction disabled.
5. Compare firmware predictions against actual future temperatures.
6. Enable conservative correction.
7. Tune correction parameters offline.
8. Collect repeated warm-up and extraction sessions.
9. Consider separate models for idle and extraction recovery.
