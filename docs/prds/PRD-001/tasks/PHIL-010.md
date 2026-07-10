# PHIL-010 — Implement the monitoring dashboard

Status: Todo
Review Mode: Human

## Human Review Needs

Approve dashboard hierarchy, readability, temperature emphasis, connection/fault presentation, and one-second updates on an iPhone.

## Goal

Present a reliable live machine snapshot with clear connection and fault states.

## Scope

- Poll state once per second only while the dashboard is active.
- Display the boiler temperature, both targets, active mode, status, heater activity, steam countdown, and uptime-derived context.
- Distinguish app offline/unauthorized/protocol states from firmware status.
- Pause/cancel polling during backgrounding and navigation.

## Non-Scope

- Temperature editing, mode mutation, charts, history, or notifications.

## Implementation Plan

1. Implement focus/app-state-aware polling.
2. Build dashboard view models and components.
3. Add fault and recovery states.
4. Test timing/cleanup and complete visual review.

## Acceptance Criteria

- [ ] Foreground dashboard updates approximately once per second.
- [ ] Polling stops when inactive and never overlaps requests.
- [ ] All required state fields are readable.
- [ ] Fault and offline states cannot be confused.
- [ ] Malformed responses produce a protocol error without stale mutation.

## Verification Strategy

Use fake timers and simulator scenarios for automated tests; complete responsive and accessibility review on iPhone.

## Dependencies

PHIL-009.

## Files Expected To Change

Mobile dashboard route/components, polling hooks, view models, theme assets, and tests.
