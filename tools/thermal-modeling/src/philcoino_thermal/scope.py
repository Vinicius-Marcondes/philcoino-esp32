from __future__ import annotations

import pandas as pd

from .config import ToolConfig


def modeling_scope_summary(frame: pd.DataFrame, config: ToolConfig) -> dict[str, object]:
    active_modes = {mode.lower() for mode in config.modeling.active_modes}
    in_mode = frame["mode"].astype(str).str.lower().isin(active_modes)
    faulted = frame["fault"].fillna("").astype(str).str.strip().ne("")
    return {
        "active_modes": sorted(active_modes),
        "included_rows": int((in_mode & ~faulted).sum()),
        "excluded_mode_rows": int((~in_mode).sum()),
        "excluded_fault_rows": int((in_mode & faulted).sum()),
    }


def healthy_modeling_segments(frame: pd.DataFrame, config: ToolConfig) -> pd.DataFrame:
    active_modes = {mode.lower() for mode in config.modeling.active_modes}
    segments: list[pd.DataFrame] = []
    for session_id, session in frame.groupby("session_id", sort=False):
        ordered = session.sort_values("timestamp").copy()
        eligible = (
            ordered["mode"].astype(str).str.lower().isin(active_modes)
            & ordered["fault"].fillna("").astype(str).str.strip().eq("")
        )
        run_number = (eligible & ~eligible.shift(fill_value=False)).cumsum()
        selected = ordered.loc[eligible].copy()
        if selected.empty:
            continue
        selected["modeling_segment_id"] = run_number.loc[eligible].map(
            lambda number: f"{session_id}-model-{int(number):04d}"
        )
        segments.append(selected)
    if not segments:
        return frame.iloc[0:0].assign(modeling_segment_id=pd.Series(dtype="string"))
    return pd.concat(segments).sort_values(["timestamp", "source_row"], kind="stable")
