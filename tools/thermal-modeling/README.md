# PhilcoINO thermal modeling

Offline Python 3.12+ analysis, model training, counterfactual simulation, tuning,
and firmware-candidate export for PhilcoINO CSV history. The firmware remains the
runtime and safety authority. This tool never flashes a device or edits firmware.

## Install

After obtaining approval to install dependencies, create a local environment:

```bash
python3.12 -m venv tools/thermal-modeling/.venv
tools/thermal-modeling/.venv/bin/python -m pip install -e './tools/thermal-modeling[test]'
```

The default configuration is `tools/thermal-modeling/config/default.yaml`.
Raw logs and generated run directories under the tool are ignored by Git.

## Commands

With `philcoino-thermal` installed in the environment:

```bash
philcoino-thermal validate data/raw --output runs/validate
philcoino-thermal analyze data/raw --output runs/analyze
philcoino-thermal train-predictor data/raw --output runs/predictor
philcoino-thermal train-plant data/raw --output runs/plant
philcoino-thermal simulate data/raw \
  --predictor runs/predictor/temp_prediction_model.json \
  --plant runs/plant/thermal_plant_model.json \
  --output runs/simulate
philcoino-thermal optimize data/raw \
  --predictor runs/predictor/temp_prediction_model.json \
  --plant runs/plant/thermal_plant_model.json \
  --output runs/optimize
philcoino-thermal export-firmware runs/weekly/models/temp_prediction_model.json \
  --output runs/export/temp_prediction_model.h
philcoino-thermal weekly-run data/raw --output runs/weekly
```

Add `--config path/to/config.yaml` to any command. `simulate` also accepts
explicit deadband, gain, hard-cutoff, and activation-band values.

## Input policy

The current mobile CSV headers are accepted directly, along with configured
legacy aliases. Timestamp, temperature, active target, heater command/state,
pump state, mode/status, and fault state are required. Scale, weight, flow,
pressure, and yield fields are ignored and never required.

When a row contains complete, schema-matching firmware diagnostics and
`prediction_usable=true`, those firmware-authored feature values take precedence.
Other rows use the causal Python reconstruction. The quality report records both
feature-source counts and parity differences from an independent reconstruction,
so interleaved live/backfilled samples cannot silently replace firmware behavior.

Actual delivered/one-second heater duty is preferred. Boolean `heater_active`
is accepted but produces a visible quality warning and reduces confidence in
the plant model and counterfactual simulation. Faulted rows remain in diagnostic
reports and are excluded from model fitting and counterfactual simulation by
default. Healthy rows on either side of a fault become separate simulation
segments.

Session boundaries are timestamp-led. A file boundary, missing/non-increasing
timestamp, or gap over five inferred sample intervals starts a new session.
Small `machine_uptime_ms` backsteps are reported as export timing jitter and do
not reset history; the default configuration treats only a rollback of at least
5000 ms as a restart. Every boundary reason is written to the quality report and
dataset manifest.

The default modeling scope is brew-only (`modeling.active_modes: [brew]`).
Steam and fault rows remain available to analysis but cannot enter predictor
fitting, plant fitting, optimization, or promotion simulation. Configure both
`brew` and `steam` only after collecting repeated independent steam sessions.

## Collecting a weekly dataset

The mobile exporter retains the current local day. Export one CSV per use day
and pass the selected daily files together; the tool does not silently filter by
wall-clock age. At least three independent sessions are required for promotion,
and five to ten separate days are preferable.

Each useful recording should include a cold warm-up, at least 30 seconds of
continuous history before brewing, three to five representative brews, two to
three minutes of recovery after each, and one to two minutes after the final
recovery. Keep the primary training set fault-free and never intentionally
trigger an over-temperature condition for data collection.

Keep inputs and generated output in separate directories:

```bash
philcoino-thermal weekly-run thermal-data/week-30/ \
  --output philcoino-week-30-results
```

## Generated outputs

Depending on the command, a run contains:

- `data_quality.json`, `dataset_manifest.json`, normalized sessions, events, and controller metrics;
- prediction metrics and 5/10/20-second Ridge artifacts;
- an ARX temperature-dynamics artifact and its observed input ranges;
- simulation/optimization CSV and JSON comparisons;
- Markdown summary and PNG plots;
- canonical `temp_prediction_model.json` and, only for a promoted candidate, `temp_prediction_model.h`.

For `weekly-run`, start with `model_report.md`. It is the human review surface:
it states the promotion decision, explains the strongest data/model insights,
compares current and candidate simulations, embeds the key charts, and links to
every detailed JSON, CSV, model, and plot directory. The remaining artifacts are
drill-down evidence and do not need to be read in sequence.

`weekly-run` places a failed model under `rejected_candidate/` and does not
generate a deployable header. Passing the configured thresholds still does not
authorize firmware changes: review, a separate firmware change, physical
validation, and manual approval remain mandatory.

## Verification

```bash
pytest tools/thermal-modeling/tests
```

The committed `tests/fixtures/golden_history.csv` is synthetic. Tests generate
three chronological sessions from it, exercise all CLI workflows, and compile a
small independent C++ runner to reproduce Python float32 predictions from the
generated header. Synthetic and simulated evidence does not establish thermal,
SSR, wiring, pump-flow, or mains safety. Real-data validation remains pending
until sufficient independent, fault-free PhilcoINO exports are supplied.
