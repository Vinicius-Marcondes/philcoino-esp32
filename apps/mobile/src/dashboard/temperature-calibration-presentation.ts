import {
  TEMPERATURE_CALIBRATION_CANDIDATE_MAX_C,
  TEMPERATURE_CALIBRATION_CANDIDATE_MIN_C,
  type TemperatureCalibrationState,
} from "@philcoino/protocol";

export interface TemperatureCalibrationPresentation {
  advisoryStableSeconds: number | null;
  canDecrease: boolean;
  canIncrease: boolean;
  candidateRawTargetC: number | null;
  effectivePreviewC: number | null;
  leaseSeconds: number | null;
  offsetPreviewC: number | null;
  previewMaximumC: number | null;
  rawTemperatureC: number | null;
  savedOffsetC: number;
}

export function temperatureCalibrationPresentation(
  snapshot: TemperatureCalibrationState | null,
): TemperatureCalibrationPresentation {
  if (snapshot === null) {
    return {
      advisoryStableSeconds: null,
      canDecrease: false,
      canIncrease: false,
      candidateRawTargetC: null,
      effectivePreviewC: null,
      leaseSeconds: null,
      offsetPreviewC: null,
      previewMaximumC: null,
      rawTemperatureC: null,
      savedOffsetC: 0,
    };
  }
  if (snapshot.status !== "calibrating") {
    return {
      advisoryStableSeconds: null,
      canDecrease: false,
      canIncrease: false,
      candidateRawTargetC: null,
      effectivePreviewC: snapshot.temperatureC,
      leaseSeconds: null,
      offsetPreviewC: null,
      previewMaximumC: null,
      rawTemperatureC: snapshot.temperatureRawC,
      savedOffsetC: snapshot.savedOffsetC,
    };
  }
  return {
    advisoryStableSeconds: Math.floor(snapshot.advisoryStableMs / 1_000),
    canDecrease:
      snapshot.candidateRawTargetC >
      TEMPERATURE_CALIBRATION_CANDIDATE_MIN_C,
    canIncrease:
      snapshot.candidateRawTargetC <
      TEMPERATURE_CALIBRATION_CANDIDATE_MAX_C,
    candidateRawTargetC: snapshot.candidateRawTargetC,
    effectivePreviewC:
      snapshot.temperatureRawC === null
        ? null
        : roundTemperature(
            snapshot.temperatureRawC + snapshot.offsetPreviewC,
          ),
    leaseSeconds: Math.ceil(snapshot.sessionLeaseRemainingMs / 1_000),
    offsetPreviewC: snapshot.offsetPreviewC,
    previewMaximumC: snapshot.previewSafeTargetBounds.maximumC,
    rawTemperatureC: snapshot.temperatureRawC,
    savedOffsetC: snapshot.savedOffsetC,
  };
}

export function signedTemperature(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}°C`;
}

export function temperatureReadout(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}°C`;
}

function roundTemperature(value: number): number {
  return Math.round(value * 10) / 10;
}
