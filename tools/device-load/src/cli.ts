import { runWorkload, type LoadScenario } from "./load.ts";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

const scenario = (process.argv[2] ?? "combined") as LoadScenario;
if (!["state", "prediction", "history", "combined"].includes(scenario)) {
  throw new Error("Scenario must be state, prediction, history, or combined.");
}

const origin = process.env.PHILCOINO_DEVICE_ADDRESS;
const token = process.env.PHILCOINO_BEARER_TOKEN;
if (origin === undefined || token === undefined || token === "") {
  throw new Error(
    "Set PHILCOINO_DEVICE_ADDRESS and PHILCOINO_BEARER_TOKEN. The token is never printed.",
  );
}

const report = await runWorkload({
  durationMs: positiveInteger(process.env.PHILCOINO_LOAD_DURATION_MS, 120_000),
  intervalMs: positiveInteger(process.env.PHILCOINO_LOAD_INTERVAL_MS, 1_000),
  maxHistoryPages: positiveInteger(
    process.env.PHILCOINO_LOAD_MAX_HISTORY_PAGES,
    100,
  ),
  mutation:
    process.env.PHILCOINO_LOAD_MUTATIONS === "heater-off"
      ? "heater-off"
      : "none",
  origin,
  scenario,
  timeoutMs: positiveInteger(process.env.PHILCOINO_LOAD_TIMEOUT_MS, 5_000),
  token,
});

console.log(JSON.stringify(report, null, 2));
