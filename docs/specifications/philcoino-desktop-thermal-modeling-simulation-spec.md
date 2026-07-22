# PhilcoINO Thermal Modeling, Simulation, and Offline Tuning
## Desktop Application Specification

**Document status:** Prototype specification  
**Runtime:** Developer computer  
**Recommended language:** Python 3.12+  
**Initial scope:** Temperature, heater, pump, and PID logs  
**Future scope:** Add scale weight and flow-rate data

---

## 1. Purpose

Create a desktop tool that analyzes PhilcoINO log exports, learns the espresso machine's thermal behavior, evaluates firmware control changes, and exports predictive-control parameters for the ESP32.

The tool is intended to be run periodically, such as after collecting a week of new sessions. It does not need to run continuously and should not directly control the machine.

Primary outputs:

1. Data-quality report.
2. Heating and extraction event analysis.
3. Future-temperature prediction model.
4. Thermal plant model for counterfactual simulation.
5. Optimized firmware parameters.
6. Generated ESP32 model header or configuration file.
7. Before-and-after validation report.

---

## 2. Important Conceptual Separation

The application requires two related but distinct models.

### 2.1 Prediction Model

Answers:

```text
Given the current state and recent history, what temperature will the existing machine reach in 5, 10, and 20 seconds?
```

This model is exported to the ESP32.

### 2.2 Plant or Dynamics Model

Answers:

```text
If the controller had selected a different heater output, how would temperature probably have changed?
```

This model is used only on the computer for simulation and parameter optimization.

A future-temperature predictor trained only on historical behavior cannot, by itself, reliably simulate heater commands that were never applied. Counterfactual control simulation requires a dynamics model that includes heater and pump inputs.

---

## 3. Goals

The desktop prototype should:

- Import one or more PhilcoINO CSV files.
- Normalize and validate their schemas.
- Detect warm-up, idle, extraction, and recovery periods.
- Calculate thermal-control metrics.
- Train a simple interpretable temperature predictor.
- Train a thermal dynamics model.
- Replay historical sessions.
- Simulate alternative predictive-correction settings.
- Prevent data leakage during validation.
- Export versioned firmware coefficients.
- Produce plots and machine-readable reports.
- Support future scale data without redesigning the core pipeline.

---

## 4. Non-Goals

The first version will not:

- Automatically flash the ESP32.
- Automatically deploy unreviewed parameters.
- Model espresso taste or extraction quality.
- Infer puck temperature with laboratory accuracy.
- Use deep neural networks.
- Require a GPU.
- Depend on cloud services.
- Replace physical over-temperature protection.

---

## 5. Recommended Technology

Suggested stack:

```text
Python
pandas or polars
numpy
scikit-learn
scipy
matplotlib
pydantic
joblib
pytest
```

Optional later tools:

```text
xgboost or lightgbm
optuna
plotly
jupyter
```

The first release should prefer scikit-learn ridge regression and simple system-identification models.

---

## 6. Project Layout

```text
philcoino-thermal/
├── pyproject.toml
├── README.md
├── data/
│   ├── raw/
│   ├── processed/
│   └── manifests/
├── models/
├── reports/
├── exports/
├── notebooks/
├── src/philcoino_thermal/
│   ├── cli.py
│   ├── schema.py
│   ├── ingest.py
│   ├── validation.py
│   ├── segmentation.py
│   ├── features.py
│   ├── metrics.py
│   ├── predictor.py
│   ├── plant_model.py
│   ├── simulator.py
│   ├── optimizer.py
│   ├── export_firmware.py
│   └── plots.py
└── tests/
```

---

## 7. Input Data

### 7.1 Current Minimum Fields

```text
timestamp
measured_temperature
target_temperature
heater_active
pump_active
status
fault
```

Column aliases should be configurable because export names may change.

### 7.2 Strongly Recommended New Fields

```text
temperature_raw
temperature_filtered
pid_output
heater_command
heater_actual_duty
controller_mode
seconds_since_heater_started
seconds_since_heater_stopped
seconds_since_pump_started
model_version
```

`heater_active` as a Boolean is usable for a first experiment, but actual duty is necessary for a more accurate plant model.

### 7.3 Future Scale Fields

```text
beverage_weight_g
flow_rate_g_s
target_weight_g
scale_valid
```

The ingestion layer must accept files without these columns and mark scale features as unavailable.

---

## 8. Data Ingestion

For every CSV:

1. Parse timestamps.
2. Sort rows chronologically.
3. Remove exact duplicates.
4. Detect missing or irregular sample intervals.
5. Split the file into continuous sessions when the timestamp gap exceeds a threshold.
6. Convert heater and pump values to numeric 0–1 fields.
7. Preserve original columns.
8. Add a file identifier and session identifier.
9. Record a hash of the source file.
10. Generate a validation summary.

Suggested session split threshold:

```text
gap > 5 × expected sample interval
```

A 15-minute gap must not be treated as a continuous thermal trajectory.

---

## 9. Data Quality Checks

The tool shall report:

- Missing timestamps.
- Duplicate timestamps.
- Non-monotonic timestamps.
- Sample interval distribution.
- Invalid temperature values.
- Sudden implausible temperature jumps.
- Missing target values.
- Heater or pump values outside valid ranges.
- Fault periods.
- Long constant sensor values.
- Inconsistent status labels.
- Files lacking actual heater duty.
- Sessions too short for training.

Faulted rows should be excluded from training by default but retained for diagnostics.

---

## 10. Session and Event Segmentation

Classify each sample into one of:

```text
WARMUP
IDLE
BREWING
POST_BREW_RECOVERY
COOLDOWN
FAULT
UNKNOWN
```

Initial rules may be deterministic.

### 10.1 Brewing Event

A brewing event begins when the pump transitions from off to on and ends when it transitions to off.

Store:

```text
event_id
start_time
end_time
duration
start_temperature
minimum_temperature
end_temperature
target_temperature
temperature_drop
heater_duty_during_event
post_event_peak
seconds_to_post_event_peak
recovery_time
```

### 10.2 Warm-Up Event

A warm-up begins when:

- Temperature is materially below target.
- Heating becomes active.
- The session has not recently been stable near target.

It ends when temperature remains inside the stability band for a configured duration.

### 10.3 Recovery Event

A recovery begins at pump-off and ends when temperature returns to the stable target band with low slope.

---

## 11. Derived Features

Feature calculations must be reproducible in both Python and firmware.

Initial feature set:

```text
temperature
target_temperature
temperature_error
temperature_slope_3s
temperature_slope_5s
temperature_acceleration
heater_duty_now
heater_energy_5s
heater_energy_15s
heater_energy_30s
pump_now
pump_time_5s
pump_time_15s
seconds_since_heater_on
seconds_since_heater_off
seconds_since_pump_on
seconds_since_pump_off
controller_mode
```

The model-training pipeline shall maintain a feature-schema version and fixed feature order.

Future optional scale features:

```text
weight
flow_rate
flow_rate_slope
estimated_time_to_target_weight
```

---

## 12. Baseline Metrics

Every model report must compare against simple baselines.

### 12.1 Persistence Baseline

```text
T_predicted(t + h) = T(t)
```

### 12.2 Linear Extrapolation Baseline

```text
T_predicted(t + h) = T(t) + h × dT_dt
```

### 12.3 Current Controller Baseline

Measure actual historical:

- Peak overshoot.
- Maximum undershoot.
- Mean absolute target error.
- Time inside ±0.5°C.
- Time inside ±1.0°C.
- Recovery time after pump-off.
- Heater duty.
- Heater switching count.

A candidate model must improve over these baselines on held-out sessions.

---

## 13. Temperature Prediction Model

### 13.1 Initial Algorithm

Use ridge regression for separate horizons:

```text
5 seconds
10 seconds
20 seconds
```

Reasons:

- Small dataset.
- Interpretable coefficients.
- Stable with correlated rolling-history features.
- Directly portable to ESP32.
- Fast enough for repeated weekly tuning.

### 13.2 Training Targets

For each sample at time `t`:

```text
y_5  = temperature at t + 5 seconds
y_10 = temperature at t + 10 seconds
y_20 = temperature at t + 20 seconds
```

Rows without a valid future sample in the same continuous session are excluded.

### 13.3 Candidate Alternatives

The tool may evaluate:

- Ordinary linear regression.
- Ridge regression.
- Lasso or elastic net.
- Random forest.
- Gradient-boosted trees.

Only a model that can be safely exported or approximated shall be selected for firmware.

The first production candidate should remain linear unless a nonlinear model produces a substantial and repeatable improvement.

---

## 14. Data Splitting and Leakage Prevention

Do not randomly split individual rows from the same thermal session into training and validation.

Preferred order:

1. Group by date or recording session.
2. Train on earlier sessions.
3. Validate on later sessions.
4. Keep at least one complete day or group of sessions as the final test set.

For a small initial dataset, use leave-one-session-out or grouped cross-validation.

All rolling features must use only current and past values.

Preprocessing statistics must be fit on training data only.

---

## 15. Prediction Evaluation

Report for each horizon:

- Mean absolute error.
- Root mean squared error.
- 90th and 95th percentile absolute error.
- Bias.
- Error during idle.
- Error during brewing.
- Error during recovery.
- Peak-temperature prediction error.
- Error near target.
- Error when temperature slope is positive.

The most important metric is not overall MAE alone. The model must accurately identify upward thermal momentum near the target.

Suggested specialized metric:

```text
MAE where:
temperature >= target - 5°C
and temperature_slope > 0
```

---

## 16. Thermal Plant Model

### 16.1 Purpose

The plant model predicts the next thermal state based on heater and pump inputs.

Minimum form:

```text
T(t + 1) =
    f(
        T(t),
        recent temperature history,
        heater command history,
        pump history,
        target or mode
    )
```

### 16.2 Recommended Initial Model

Use a low-order autoregressive model with exogenous inputs, commonly described as ARX.

Example:

```text
T_next =
    c0
  + c1 * T_now
  + c2 * T_previous
  + c3 * heater_now
  + c4 * heater_5s
  + c5 * heater_15s
  + c6 * pump_now
  + c7 * pump_5s
  + c8 * temperature_slope
```

This model is intended for simulation, not necessarily firmware deployment.

### 16.3 Thermal Lag State

If simple rolling features are insufficient, introduce a latent heater-energy state:

```text
E_heat_next = decay_heat * E_heat + gain_heat * heater_command
E_pump_next = decay_pump * E_pump + gain_pump * pump_command

T_next =
    T
  + cooling_coefficient * (ambient_temperature - T)
  + E_heat
  - E_pump
```

The parameters may be estimated with nonlinear least squares.

This structure is physically interpretable and may simulate unseen duty sequences better than a purely statistical predictor.

---

## 17. Simulator

The simulator shall accept:

```text
initial thermal state
target-temperature timeline
pump-state timeline
controller configuration
prediction-model configuration
plant-model configuration
simulation timestep
```

At every simulation step:

1. Read current simulated state.
2. Calculate firmware-equivalent features.
3. Run the existing PID.
4. Run the predictive correction.
5. Apply heater limits.
6. Pass heater and pump inputs to the plant model.
7. Produce the next simulated temperature.
8. Store all state and control values.

The feature and control calculations should share equations or generated fixtures with the firmware implementation to minimize drift.

---

## 18. Counterfactual Limitations

The report must state confidence limits.

Simulation is less reliable when:

- Proposed heater duty is far outside the range observed in training.
- Pump durations differ substantially from historical events.
- The machine starts from an unseen temperature.
- Ambient conditions are different.
- Actual heater duty was not logged.
- Boiler fill level or hardware configuration changed.
- Sensor placement changed.

The optimizer shall penalize or reject configurations that push the simulator outside training bounds.

---

## 19. Controller Parameter Optimization

Parameters to optimize initially:

```text
prediction_deadband
prediction_gain
hard_cutoff_margin
activation_band
prediction horizons
PID proportional gain
PID integral gain
PID derivative gain
integral clamp
brew-mode correction multiplier
post-brew correction multiplier
```

PID optimization may be deferred until the prediction layer has been validated.

### 19.1 Objective Function

Recommended weighted cost:

```text
cost =
    w1 * peak_overshoot
  + w2 * integrated_absolute_error
  + w3 * recovery_time
  + w4 * heater_switching_penalty
  + w5 * undershoot_penalty
  + w6 * safety_margin_penalty
```

Overshoot should receive a higher penalty than a small temporary undershoot.

Example initial weights:

```text
overshoot: 5
undershoot: 2
absolute error: 1
recovery time: 0.5
switching: 0.1
safety violation: very large
```

Use grid search or bounded Bayesian optimization. A small grid search is sufficient for the first prototype.

---

## 20. Weekly Tuning Workflow

Recommended workflow:

1. Export new PhilcoINO logs.
2. Copy them into `data/raw`.
3. Run validation and session segmentation.
4. Review data-quality warnings.
5. Retrain candidate models using all approved sessions.
6. Validate on the latest held-out sessions.
7. Fit or update the plant model.
8. Simulate the current firmware configuration.
9. Optimize predictive-control parameters.
10. Compare current and proposed configurations.
11. Generate a human-readable report.
12. Export a versioned firmware header.
13. Manually review and commit the generated file.
14. Flash the ESP32 through the normal development workflow.
15. Collect new comparison sessions.

The first versions should require manual approval before firmware changes are accepted.

---

## 21. Command-Line Interface

Suggested commands:

```bash
philcoino-thermal validate data/raw
philcoino-thermal analyze data/raw --output reports/latest
philcoino-thermal train-predictor data/raw --output models/predictor
philcoino-thermal train-plant data/raw --output models/plant
philcoino-thermal simulate --config configs/current.yaml
philcoino-thermal optimize --baseline configs/current.yaml
philcoino-thermal export-firmware models/predictor --output exports/temp_prediction_model.h
philcoino-thermal weekly-run data/raw --output reports/weekly
```

---

## 22. Configuration

Use a version-controlled YAML file.

Example:

```yaml
schema_version: 1

sampling:
  expected_interval_seconds: 1.0
  session_gap_seconds: 5.0

features:
  slope_windows_seconds: [3, 5]
  heater_windows_seconds: [5, 15, 30]
  pump_windows_seconds: [5, 15]

predictor:
  horizons_seconds: [5, 10, 20]
  algorithm: ridge
  alpha_values: [0.01, 0.1, 1.0, 10.0]

controller:
  prediction_deadband_bounds: [0.0, 1.0]
  prediction_gain_bounds: [0.0, 1.0]
  hard_cutoff_margin_bounds: [0.0, 2.0]
  activation_band_bounds: [3.0, 15.0]

validation:
  stable_band_celsius: 0.5
  maximum_valid_temperature: 130.0
```

---

## 23. Reports and Visualizations

Generate:

1. Full-session temperature chart.
2. Target, temperature, heater, and pump timeline.
3. One chart per extraction and recovery event.
4. Predicted versus actual temperature at each horizon.
5. Prediction residual distribution.
6. Overshoot distribution by firmware/model version.
7. Simulation comparison between current and candidate controller.
8. Heater-duty comparison.
9. Feature and coefficient report.
10. Input-range and extrapolation warnings.

Every report shall identify:

```text
source file hashes
training sessions
validation sessions
test sessions
feature schema version
model version
firmware configuration version
```

---

## 24. Firmware Export

The exporter shall produce:

```text
temp_prediction_model.h
temp_prediction_model.json
model_report.md
```

The C++ header must include:

- Fixed feature order.
- Coefficients for each horizon.
- Feature means and scales, if used.
- Controller correction parameters.
- Training input ranges.
- Model and schema versions.
- Creation timestamp.
- Dataset hash.
- Validation metrics.
- Compile-time constants for array sizes.

The JSON file is the canonical machine-readable artifact. The C++ header is generated from it.

---

## 25. Model Promotion Rules

A candidate model may be promoted only when:

1. It beats the persistence baseline at all required horizons.
2. It improves positive-slope, near-target prediction.
3. It does not introduce material negative bias.
4. It improves simulated overshoot.
5. It remains within safety constraints.
6. It performs acceptably on sessions not used for training.
7. Its feature schema matches the firmware.
8. Its input ranges cover the intended operating conditions.

Suggested initial promotion thresholds:

```text
At least 15% lower 10-second MAE than persistence
At least 20% lower near-target rising-temperature MAE
At least 30% lower simulated median overshoot
No more than 20% increase in simulated recovery time
```

These thresholds should be revised after more data is collected.

---

## 26. Testing Requirements

### 26.1 Unit Tests

Test:

- Timestamp parsing.
- Session splitting.
- Rolling features.
- Future-target alignment.
- No future leakage.
- Predictor calculations.
- Python-to-C++ coefficient parity.
- Simulation step behavior.
- Firmware export determinism.
- Invalid-data handling.

### 26.2 Golden Test

Create a small fixed CSV fixture and expected output containing:

- Derived features.
- Predictions.
- Controller correction.
- Exported coefficients.

Run the same feature vector through Python and a firmware-side test to verify numerically equivalent output within tolerance.

### 26.3 Regression Tests

Store key metrics from approved models and fail the pipeline when a new model unexpectedly degrades them beyond configured tolerances.

---

## 27. Data Collection Plan

For a useful first model, collect:

- Multiple complete warm-ups.
- Repeated idle heating cycles.
- At least 20 extraction or flush events for an early prototype.
- Preferably 50–100 extraction or flush events for a more stable model.
- Several target temperatures.
- Different starting temperatures.
- Different pump durations.
- Sessions on different days.
- Actual heater duty rather than Boolean state.

Controlled water-only flushes are useful because they create repeatable pump disturbances without consuming coffee.

Record any hardware changes, including:

- Sensor replacement or relocation.
- Boiler modification.
- SSR control-window change.
- Pump dimmer change.
- Firmware PID change.

Such changes may require a new model generation.

---

## 28. Future Scale Integration

When scale data becomes available:

1. Add scale columns as optional fields.
2. Create `feature_schema_version = 2`.
3. Calculate smoothed flow rate.
4. Add flow-related pump-cooling features.
5. Retrain both predictor and plant models.
6. Compare models with and without scale features.
7. Keep a fallback model that does not require the scale.
8. Later add extraction-stop prediction as a separate module.

The temperature project and weight-stop project should remain separate logical components:

```text
Temperature predictor:
    Protect and stabilize thermal behavior.

Yield predictor:
    Estimate when to stop the pump for target beverage weight.
```

They may share flow-rate inputs but should not be one inseparable model.

---

## 29. Delivery Phases

### Phase 1 — Analysis Only

- Import CSV.
- Detect sessions and extractions.
- Generate plots and control metrics.
- No firmware export.

### Phase 2 — Passive Predictor

- Train 5/10/20-second ridge models.
- Export coefficients.
- Run predictor in firmware with correction disabled.
- Compare predictions with actual results.

### Phase 3 — Conservative Predictive Correction

- Enable reduction-only correction.
- Use fixed safe bounds.
- Perform controlled A/B tests.

### Phase 4 — Plant Simulation and Optimization

- Train plant model.
- Simulate controller configurations.
- Optimize predictive settings.
- Keep manual approval.

### Phase 5 — Scale and Flow Features

- Add weight and flow-rate data.
- Improve pump-disturbance modeling.
- Develop separate target-weight stopping logic.

---

## 30. Acceptance Criteria

The desktop prototype is acceptable when it can:

1. Process multiple PhilcoINO CSV exports without manual editing.
2. Correctly split discontinuous sessions.
3. Detect pump events.
4. Produce current-controller overshoot and recovery metrics.
5. Train and evaluate future-temperature models without leakage.
6. Export coefficients that reproduce Python predictions in C++.
7. Simulate the current controller with documented error.
8. Compare at least two predictive-control configurations.
9. Reject candidate settings that exceed safety or extrapolation limits.
10. Produce a report clear enough to justify or reject a firmware update.
11. Accept missing scale columns without failure.
12. Version every schema, dataset, model, and firmware export.

---

## 31. Recommended First Milestone

The first implementation should stop after the passive-predictor stage:

```text
CSV ingestion
→ event detection
→ feature generation
→ ridge models for 5/10/20 seconds
→ validation report
→ generated C++ header
→ firmware logging of predictions
```

Do not enable automatic heater correction until passive predictions have been compared against several real sessions.

This sequence validates that the computer and ESP32 calculate the same features and predictions before the model is allowed to affect the heater.
