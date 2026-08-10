# SIMP-004 — Simplify mobile profiles and status history

Status: Done
Review Mode: Agent
Review Reason: Persistence, polling, lifecycle, export, and API behavior are deterministic.

## Goal

Make profiles phone-only and retain foreground state samples locally until clear.

## Scope

- Remove remote profile synchronization and send exact local profiles with Start.
- Remove machine backfill and recovery UI/client code.
- Retain all local status rows, show today, export all in bounded memory, and
  expose confirmed clear.

## Non-Scope

- Shot navigation and detail UI.

## Implementation Plan

1. Localize profile-set schemas and simplify Dashboard orchestration.
2. Remove history synchronization and migrate the local repository.
3. Update export, clear, lifecycle, localization, and tests.

## Acceptance Criteria

- [x] No mobile request targets removed routes.
- [x] Stored status survives lifecycle/restart, preserves gaps, and is not pruned.
- [x] Profile Start uses the exact locally persisted profile.

## Verification Strategy

- Run affected mobile tests, typecheck, and lint.

## Dependencies

- SIMP-001 and SIMP-002.

## Files Expected To Change

- `apps/mobile/hooks/`
- `apps/mobile/src/profiles/`
- `apps/mobile/src/history/`
- `apps/mobile/components/`
