# PRD-005 implementation evidence

Date: 2026-07-17

Branch: `feature/PRD-005-firmware-api-codec`

Baseline: untouched `main` commit `0a4a42c`

## Behavior and contract

- `api_characterization.json` records all 14 registered routes (2 public and
  12 protected), authentication classes, unsupported method/path behavior,
  transport limits, and accepted/rejected body classes.
- The pre-refactor and final firmware capture directories each contain 29
  responses. `diff -ru` reports no differences, so the characterized response
  bodies are byte-identical.
- The independent TypeScript validator accepts all 29 final firmware captures.
- OpenAPI validation, protocol type checking, and 117 protocol tests with 233
  expectations pass.

## Host and adversarial verification

- Strict C++17 host build with `-Wall -Wextra -Werror`: pass.
- Native CTest: 6/6 pass.
- Sanitizer-configured CTest: 6/6 pass; the direct codec and deterministic
  mutation/property targets are compiled with ASan/UBSan instrumentation.
- The checked-in seed corpus is derived from protocol request fixtures,
  firmware response captures, and minimal valid/invalid JSON cases. The
  deterministic runner covers those bounded seeds, field order and
  whitespace, every-byte truncation, deterministic byte mutation,
  duplicate/unknown fields, scalar substitutions, malformed numbers, strings,
  escapes and composites, nested shapes, and the 1,024-byte boundary.
- The runner calls generic JSON and every machine/workflow request parser twice
  for each input and requires deterministic classification. Rejected inputs
  retain their caller-owned output values.
- `LLVMFuzzerTestOneInput` exercises the same pure boundaries. No fuzzing
  dependency was installed.

An early sanitizer run found a stack-use-after-scope caused by constructing the
reference-owning JSON parser from a temporary string in a direct test. The
parser now deletes its rvalue constructor, and the corrected regression passes
under ASan/UBSan.

## ESP32-C3 target and static resource comparison

Both baseline and final builds use ESP-IDF 6.0.2, target `esp32c3`, and managed
`espressif/mdns` 1.11.3.

| Measurement | `main` baseline | Final | Delta | Budget | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Partition binary | 1,130,944 B | 1,131,440 B | +496 B (+0.0439%) | <= +2% | Pass |
| Total image | 1,130,562 B | 1,131,050 B | +488 B (+0.0432%) | <= +2% | Pass |
| Flash `.text` | 897,472 B | 897,366 B | -106 B | Informational | Pass |
| Flash `.rodata` | 146,568 B | 146,728 B | +160 B | Informational | Pass |
| DRAM `.data` | 13,616 B | 13,616 B | 0 B | Combined below | Pass |
| DRAM `.bss` | 25,800 B | 25,800 B | 0 B | Combined below | Pass |
| `.data + .bss` | 39,416 B | 39,416 B | 0 B | <= +1,024 B | Pass |
| App partition free | 441,920 B (28%) | 441,424 B (28%) | -496 B | Must fit | Pass |

The final pinned target build completes without partition overflow. The HTTP
server stack remains explicitly configured at 6,144 bytes in
`esp_networking.cpp`; it was not increased.

## Evidence that remains unavailable

No ESP32-C3 is connected to this workspace, so representative maximum-request
peak heap consumption and HTTP task high-water/unused-stack measurements cannot
be produced. The approved limits of +1 KiB request heap, at least 1,536 bytes
unused HTTP stack, and no more than 512 bytes of stack-margin regression remain
target-runtime acceptance checks.

The untouched pre-refactor baseline and final cumulative target measurements
are reproducible, but separate target-size snapshots were not preserved after
each logical extraction boundary. The final result is far inside the static
budgets, but it does not retroactively provide the PRD's per-stage records.

On 2026-07-18, the owner explicitly accepted the final cumulative static
evidence and the exception for unavailable connected-target heap/stack
measurements and missed per-stage snapshots, closing PRD-005/FW-013 acceptance.
The unavailable measurements remain documented limitations and are not
physical heater, pump, wiring, thermal, or mains-safety evidence.
