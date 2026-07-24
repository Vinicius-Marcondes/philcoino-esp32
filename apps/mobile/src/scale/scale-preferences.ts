import type { ProfileSlotId, WeightControl } from "@philcoino/protocol";

export const DEFAULT_WEIGHT_CONTROL: WeightControl = {
  targetWeightDecigrams: 350,
  compensationDecigrams: 10,
};

export type ScaleProfileDefaults = Record<ProfileSlotId, WeightControl>;

export interface ScalePreferencesRepository {
  load(deviceId: string): Promise<ScaleProfileDefaults>;
  save(
    deviceId: string,
    profileId: ProfileSlotId,
    value: WeightControl,
  ): Promise<ScaleProfileDefaults>;
}

export function defaultScaleProfileDefaults(): ScaleProfileDefaults {
  return {
    "profile-1": { ...DEFAULT_WEIGHT_CONTROL },
    "profile-2": { ...DEFAULT_WEIGHT_CONTROL },
    "profile-3": { ...DEFAULT_WEIGHT_CONTROL },
    "profile-4": { ...DEFAULT_WEIGHT_CONTROL },
  };
}
