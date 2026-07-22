from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import ToolConfig


def segment_operating_state(frame: pd.DataFrame, config: ToolConfig) -> pd.DataFrame:
    output = frame.copy()
    states: list[str] = []
    for _, session in output.groupby("session_id", sort=False):
        recovery_until_stable = False
        for _, row in session.iterrows():
            if str(row["fault"]).strip():
                state = "FAULT"; recovery_until_stable = False
            elif float(row["pump"] or 0) > 0:
                state = "BREWING"; recovery_until_stable = True
            elif recovery_until_stable:
                stable = abs(float(row["temperature"] - row["target"])) <= config.validation.stable_band_c
                low_slope = abs(float(row.get("temperature_slope_c_per_s", 0))) <= config.controller.recovery_stable_slope_c_per_s
                state = "IDLE" if stable and low_slope else "POST_BREW_RECOVERY"
                recovery_until_stable = state != "IDLE"
            elif str(row["status"]).lower() == "ready":
                state = "IDLE"
            elif str(row["status"]).lower() in {"cooldown", "stabilizing"}:
                state = "COOLDOWN"
            elif float(row["temperature"]) < float(row["target"]) - config.validation.stable_band_c:
                state = "WARMUP"
            else:
                state = "UNKNOWN"
            states.append(state)
    output["segment"] = states
    return output


def extract_events(frame: pd.DataFrame, config: ToolConfig) -> pd.DataFrame:
    events: list[dict[str, Any]] = []
    event_number = 0
    for session_id, session in frame.groupby("session_id", sort=False):
        session = session.sort_values("timestamp")
        pump = session["pump"].fillna(0).to_numpy(dtype=float) > 0.5
        starts = np.flatnonzero(pump & ~np.r_[False, pump[:-1]])
        ends = np.flatnonzero(pump & ~np.r_[pump[1:], False])
        for start in starts:
            possible = ends[ends >= start]
            end = int(possible[0]) if len(possible) else len(session) - 1
            event_number += 1
            shot = session.iloc[start:end + 1]
            after = session.iloc[end + 1:]
            target = float(shot["target"].iloc[0])
            stable = after[(after["temperature"].sub(after["target"]).abs() <= config.validation.stable_band_c) & (after.get("temperature_slope_c_per_s", pd.Series(0, index=after.index)).abs() <= config.controller.recovery_stable_slope_c_per_s)]
            recovery_time = None if stable.empty else (stable["timestamp"].iloc[0] - shot["timestamp"].iloc[-1]).total_seconds()
            post = after.head(max(1, int(config.controller.recovery_timeout_seconds)))
            peak_index = post["temperature"].idxmax() if not post.empty else shot.index[-1]
            peak_row = frame.loc[peak_index]
            events.append({
                "event_type": "BREWING", "event_id": f"brew-{event_number:04d}", "session_id": session_id,
                "start_time": shot["timestamp"].iloc[0].isoformat(), "end_time": shot["timestamp"].iloc[-1].isoformat(),
                "duration_seconds": (shot["timestamp"].iloc[-1] - shot["timestamp"].iloc[0]).total_seconds(),
                "start_temperature_c": float(shot["temperature"].iloc[0]), "minimum_temperature_c": float(shot["temperature"].min()),
                "end_temperature_c": float(shot["temperature"].iloc[-1]), "target_temperature_c": target,
                "temperature_drop_c": float(shot["temperature"].iloc[0] - shot["temperature"].min()),
                "mean_heater_duty": float(shot["heater_duty"].fillna(shot["heater_active"]).mean()),
                "post_event_peak_c": float(peak_row["temperature"]),
                "seconds_to_post_event_peak": (peak_row["timestamp"] - shot["timestamp"].iloc[-1]).total_seconds(),
                "recovery_time_seconds": recovery_time,
                "post_event_overshoot_c": max(0.0, float(peak_row["temperature"] - target)),
            })
        for state in ("WARMUP", "POST_BREW_RECOVERY"):
            selected = session["segment"].eq(state).to_numpy()
            starts = np.flatnonzero(selected & ~np.r_[False, selected[:-1]])
            ends = np.flatnonzero(selected & ~np.r_[selected[1:], False])
            for sequence, (start, end) in enumerate(zip(starts, ends, strict=True), start=1):
                period = session.iloc[int(start):int(end) + 1]
                events.append({
                    "event_type": state, "event_id": f"{state.lower()}-{session_id}-{sequence:03d}", "session_id": session_id,
                    "start_time": period["timestamp"].iloc[0].isoformat(), "end_time": period["timestamp"].iloc[-1].isoformat(),
                    "duration_seconds": (period["timestamp"].iloc[-1] - period["timestamp"].iloc[0]).total_seconds(),
                    "start_temperature_c": float(period["temperature"].iloc[0]), "minimum_temperature_c": float(period["temperature"].min()),
                    "end_temperature_c": float(period["temperature"].iloc[-1]), "target_temperature_c": float(period["target"].iloc[0]),
                    "temperature_drop_c": float(period["temperature"].iloc[0] - period["temperature"].min()),
                    "mean_heater_duty": float(period["heater_duty"].fillna(period["heater_active"]).mean()),
                    "post_event_peak_c": float(period["temperature"].max()), "seconds_to_post_event_peak": None,
                    "recovery_time_seconds": period["timestamp"].iloc[-1].timestamp() - period["timestamp"].iloc[0].timestamp() if state == "POST_BREW_RECOVERY" else None,
                    "post_event_overshoot_c": max(0.0, float(period["temperature"].max() - period["target"].iloc[0])),
                })
    return pd.DataFrame(events)
