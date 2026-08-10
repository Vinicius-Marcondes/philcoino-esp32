# Local history CSV exports

Status: IMPLEMENTED

The mobile app owns all long-lived telemetry. Exports contain no bearer token or
network address and never represent physical heater current, pump flow, or
confirmed de-energization.

## Machine status history

Machine exports every stored status row for the selected device, in ascending
capture order. Native export iterates SQLite rows in batches and writes the
temporary CSV incrementally instead of loading indefinite history into memory.
Dashboard still loads and graphs only the current local day.

Columns are:

```text
recorded_at_utc,device_id,machine_uptime_ms,boiler_temperature_c,brew_target_c,steam_target_c,active_mode,active_target_c,steam_control_temperature_c,steam_applied_compensation_c,steam_compensation_active,steam_heat_soak_elapsed_ms,heater_enabled,heater_active,pump_command,machine_status,fault_code
```

Background, locked, offline, and closed periods produce no rows and remain
explicit timestamp/uptime gaps. No firmware backfill rows, cursors, provenance,
recovery state, or controller-history diagnostics are exported.

## Shot summary history

Shots exports every retained Manual, timed, and weighted record in the list,
including stopped, failed, and incomplete shots. The summary includes the exact
executed profile snapshot rather than resolving the current contents of its
mobile slot.

```text
timestamp_utc,device_id,extraction_id,boot_id,control_mode,selection,profile_name,pre_infusion_seconds,soak_seconds,main_extraction_seconds,duration_ms,outcome,record_status,trace_completeness,trace_sample_count,target_g,compensation_g,cutoff_g,final_weight_g,settled,fallback_occurred
```

`outcome` and terminal measurements may be empty for an incomplete record.
`record_status` distinguishes `running`, `complete`, and `incomplete` lifecycle
state. `trace_completeness` reports the replay result when available.

## Individual shot trace

An individual trace export includes its immutable profile snapshot, temperature,
target, firmware command state, nullable weight/flow values, phase, both elapsed
clocks, and gap status. Missing weight or flow remains an empty cell; the app
does not synthesize unavailable samples.

```text
elapsed_ms,extraction_elapsed_ms,firmware_uptime_ms,control_mode,selection,profile_name,pre_infusion_seconds,soak_seconds,main_extraction_seconds,temperature_c,target_c,baseline_weight_g,weight_g,target_weight_g,compensation_g,cutoff_weight_g,terminal_weight_g,terminal_settled,weight_completion_reason,weight_fallback_occurred,derived_flow_g_per_s,phase,heater_command,pump_command,scale_availability,gap_status
```

All files use UTF-8, RFC 4180-style CRLF rows, decimal points independent of UI
locale, and spreadsheet-safe escaping for text fields.
