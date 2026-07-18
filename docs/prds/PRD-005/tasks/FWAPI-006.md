# FWAPI-006 — Add deterministic mutation and sanitizer coverage

Status: Done
Review Mode: Agent
Review Reason: Corpus behavior, mutation determinism, sanitizer results, and minimized regression seeds are machine-verifiable.

## Goal

Exercise every pure codec boundary adversarially without adding or installing a fuzzing dependency.

## Scope

- Add engine-neutral `LLVMFuzzerTestOneInput`-compatible entry points for generic JSON and each distinct domain parser.
- Seed a checked-in corpus from protocol fixtures, firmware captures, and minimal valid/invalid payloads.
- Add a repository-owned deterministic mutation runner covering permutation, whitespace, type substitution, duplication, unknown fields, truncation, and malformed tokens.
- Build and run the mutation/property suite under AddressSanitizer and UndefinedBehaviorSanitizer.
- Prove rejected inputs do not mutate controller, storage, idempotency, fault, or output-command state.

## Non-Scope

- Installing libFuzzer or another toolchain, making coverage-guided fuzzing mandatory, or fuzzing ESP-IDF/network/hardware code on target.

## Implementation Plan

1. Define reusable engine-neutral fuzz targets over pure codec interfaces.
2. Add deterministic corpus loading and bounded mutations with fixed seeds.
3. Add sanitizer-enabled host build configuration and reproducible commands.
4. Minimize and retain every discovered crash or semantic mismatch.

## Acceptance Criteria

- [x] Generic JSON and every domain parser have seeded engine-neutral fuzz entry points.
- [x] The deterministic runner produces reproducible cases and covers all PRD mutation classes.
- [x] ASan/UBSan mutation and property runs complete without crash, UB, leak, hang, or out-of-bounds access.
- [x] Rejected input is proven mutation-free at direct and route levels.
- [x] No new dependency or installed tool is required.

Completion Evidence: `../evidence/IMPLEMENTATION.md`

## Verification Strategy

- Run normal and sanitizer-enabled CMake/CTest targets plus the deterministic mutation command; optionally run compatible coverage-guided tooling only if already available.

## Dependencies

- FWAPI-005 complete.

## Files Expected To Change

- `firmware/espresso-machine/host-tests/`
- `firmware/espresso-machine/host-tests/CMakeLists.txt`
- `firmware/espresso-machine/README.md`
- `docs/DEVELOPMENT.md`
