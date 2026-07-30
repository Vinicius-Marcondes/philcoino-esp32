import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TemperatureCalibrationState } from "@philcoino/protocol";

import {
  signedTemperature,
  temperatureCalibrationPresentation,
  temperatureReadout,
} from "../src/dashboard/temperature-calibration-presentation";

describe("temperature calibration presentation", () => {
  test("derives raw, effective preview, offset, stability, lease, and bounds from acknowledged state", () => {
    const snapshot: TemperatureCalibrationState = {
      status: "calibrating",
      savedOffsetC: 0,
      boilerTemperatureRawC: 108.2,
      boilerTemperatureC: 108.2,
      heaterActive: true,
      ready: true,
      safeTargetBounds: safeBounds(0),
      calibrationId: "temp-cal-present-0001",
      candidateRawTargetC: 108,
      offsetPreviewC: -8,
      advisoryStableMs: 3_999,
      sessionLeaseRemainingMs: 14_001,
      previewSafeTargetBounds: safeBounds(-8),
    };

    expect(temperatureCalibrationPresentation(snapshot)).toEqual({
      advisoryStableSeconds: 3,
      canDecrease: true,
      canIncrease: true,
      candidateRawTargetC: 108,
      effectivePreviewC: 100.2,
      leaseSeconds: 15,
      offsetPreviewC: -8,
      previewSteamMaximumC: 127,
      rawTemperatureC: 108.2,
      savedOffsetC: 0,
    });
  });

  test("keeps whole-degree controls inside acknowledged 90–120°C bounds", () => {
    expect(
      temperatureCalibrationPresentation(activeAt(90)).canDecrease,
    ).toBe(false);
    expect(
      temperatureCalibrationPresentation(activeAt(90)).canIncrease,
    ).toBe(true);
    expect(
      temperatureCalibrationPresentation(activeAt(120)).canDecrease,
    ).toBe(true);
    expect(
      temperatureCalibrationPresentation(activeAt(120)).canIncrease,
    ).toBe(false);
  });

  test("formats signed offsets and unavailable readings without inventing data", () => {
    expect(signedTemperature(-8)).toBe("−8°C");
    expect(signedTemperature(5)).toBe("+5°C");
    expect(signedTemperature(0)).toBe("0°C");
    expect(temperatureReadout(null)).toBe("—");
    expect(temperatureReadout(100)).toBe("100.0°C");
  });
});

describe("temperature calibration component wiring", () => {
  const component = readFileSync(
    resolve(
      import.meta.dir,
      "../components/temperature-calibration-screen.tsx",
    ),
    "utf8",
  );
  const dashboard = readFileSync(
    resolve(import.meta.dir, "../components/dashboard-screen.tsx"),
    "utf8",
  );
  const controls = readFileSync(
    resolve(import.meta.dir, "../components/machine-controls.tsx"),
    "utf8",
  );

  test("opens from Machine without changing dashboard page navigation order", () => {
    expect(controls).toContain("onOpenTemperatureCalibration");
    expect(dashboard).toContain("<TemperatureCalibrationScreen");
    expect(dashboard).toContain(
      "setTemperatureCalibrationOpen(true)",
    );
    expect(dashboard).not.toContain(
      'type DashboardPage = "temperature-calibration"',
    );
  });

  test("keeps the heater control first and prevents landscape card overflow", () => {
    expect(dashboard.indexOf("<HeaterToggleBar")).toBeLessThan(
      dashboard.indexOf("<MachineControls"),
    );
    expect(dashboard).toContain(
      'machineLayoutLandscape: {\n    flexDirection: "column",',
    );
    expect(controls).toContain("calibrationCardLandscape");
    expect(controls).toContain(
      'calibrationCardLandscape: { flexBasis: "100%" }',
    );
  });

  test("uses only the session hook and requires review before Save", () => {
    expect(component).toContain("useTemperatureCalibration");
    expect(component).not.toContain("fetch(");
    expect(component).toContain("confirmingSave");
    expect(component).toContain("temperatureCalibration.reviewSave");
    expect(component).toContain("temperatureCalibration.confirmSave");
    expect(component).toContain("if (!visible)");
    expect(component).toContain("setConfirmingSave(false)");
    expect(component).toContain("setCloseAfterCancel(false)");
  });

  test("keeps manual-wand safety copy and accessible whole-degree controls visible", () => {
    expect(component).toContain("temperatureCalibration.openWandTitle");
    expect(component).toContain("temperatureCalibration.noDetection");
    expect(component).toContain('accessibilityRole="button"');
    expect(component).toContain("active.candidateRawTargetC - 1");
    expect(component).toContain("active.candidateRawTargetC + 1");
    expect(component).not.toContain("startExtraction");
    expect(component).not.toContain("pump");
  });

  test("uses a scrolling responsive full-screen surface", () => {
    expect(component).toContain('presentationStyle="fullScreen"');
    expect(component).toContain("supportedOrientations={[");
    expect(component).toContain('"landscape-left"');
    expect(component).toContain('"landscape-right"');
    expect(component).toContain("<ScrollView");
    expect(component).toContain("useWindowDimensions()");
    expect(component).toContain(
      'mobileLayoutMode(windowSize) === "landscape"',
    );
    expect(component).toContain(
      'contentInsetAdjustmentBehavior="automatic"',
    );
    expect(component).toContain("activeLayoutLandscape");
    expect(component).toContain("activeColumnLandscape");
    expect(component).toContain("stepButtonLandscape");
    expect(component).toContain("metricLandscape");
  });
});

function activeAt(candidateRawTargetC: number): TemperatureCalibrationState {
  const offsetPreviewC = 100 - candidateRawTargetC;
  return {
    status: "calibrating",
    savedOffsetC: 0,
    boilerTemperatureRawC: candidateRawTargetC,
    boilerTemperatureC: candidateRawTargetC,
    heaterActive: false,
    ready: false,
    safeTargetBounds: safeBounds(0),
    calibrationId: "temp-cal-present-0001",
    candidateRawTargetC,
    offsetPreviewC,
    advisoryStableMs: 0,
    sessionLeaseRemainingMs: 15_000,
    previewSafeTargetBounds: safeBounds(offsetPreviewC),
  };
}

function safeBounds(offsetC: number) {
  return {
    brewMinimumC: 85 as const,
    brewMaximumC: Math.min(95, 135 + offsetC),
    steamMinimumC: 110 as const,
    steamMaximumC: Math.min(135, 135 + offsetC),
  };
}
