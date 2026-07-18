import { describe, expect, test } from "bun:test";

import {
  MUTATION_FEEDBACK_DISMISS_MS,
  mutationFeedbackIsVisible,
  mutationFeedbackShouldAutoDismiss,
} from "../src/dashboard/mutation-feedback";
import { translations } from "../src/localization/translations";

describe("mutation feedback", () => {
  test("auto-dismisses terminal feedback after five seconds", () => {
    expect(MUTATION_FEEDBACK_DISMISS_MS).toBe(5_000);
    expect(mutationFeedbackShouldAutoDismiss("acknowledged")).toBe(true);
    expect(mutationFeedbackShouldAutoDismiss("rejected")).toBe(true);
    expect(mutationFeedbackShouldAutoDismiss("disconnected")).toBe(true);
    expect(mutationFeedbackShouldAutoDismiss("pending")).toBe(false);
  });

  test("shows only failures for actions without success notifications", () => {
    expect(mutationFeedbackIsVisible("pending", "errors-only")).toBe(false);
    expect(mutationFeedbackIsVisible("acknowledged", "errors-only")).toBe(false);
    expect(mutationFeedbackIsVisible("rejected", "errors-only")).toBe(true);
    expect(mutationFeedbackIsVisible("disconnected", "errors-only")).toBe(true);
  });

  test("keeps profile, temperature, and heater feedback visible", () => {
    expect(mutationFeedbackIsVisible("pending", "all")).toBe(true);
    expect(mutationFeedbackIsVisible("acknowledged", "all")).toBe(true);
    expect(mutationFeedbackIsVisible("idle", "all")).toBe(false);
  });

  test("uses distinct ESP32-confirmed heater on and off messages", () => {
    expect(translations.en.mutation.heaterAllowed).toBe(
      "ESP32 acknowledged: automatic heater control was turned on.",
    );
    expect(translations.en.mutation.heaterOff).toBe(
      "ESP32 acknowledged: automatic heater control was turned off.",
    );
    expect(translations["pt-BR"].mutation.heaterAllowed).toContain("foi ligado");
    expect(translations["pt-BR"].mutation.heaterOff).toContain("foi desligado");
  });

  test("limits routine success notifications in the dashboard", async () => {
    const source = await Bun.file(
      new URL("../components/dashboard-screen.tsx", import.meta.url),
    ).text();

    for (const state of [
      "faultMutation",
      "extractionStartMutation",
      "extractionStopMutation",
      "cooldownStartMutation",
      "cooldownStopMutation",
      "modeMutation",
    ]) {
      expect(source).toContain(
        `state={${state}}\n              visibility="errors-only"`,
      );
    }

    expect(source).toContain('translate("mutation.profileSavedLocally")');
    expect(source).toContain("state={temperatureMutation}");
    expect(source).toContain("state={heaterMutation}");
  });
});
