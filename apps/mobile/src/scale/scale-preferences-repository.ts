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

export class InMemoryScalePreferencesRepository
  implements ScalePreferencesRepository
{
  private readonly records = new Map<string, ScaleProfileDefaults>();

  async load(deviceId: string): Promise<ScaleProfileDefaults> {
    return clone(this.records.get(deviceId) ?? defaultScaleProfileDefaults());
  }

  async save(
    deviceId: string,
    profileId: ProfileSlotId,
    value: WeightControl,
  ): Promise<ScaleProfileDefaults> {
    const current = await this.load(deviceId);
    current[profileId] = { ...value };
    this.records.set(deviceId, current);
    return clone(current);
  }
}

function clone(value: ScaleProfileDefaults): ScaleProfileDefaults {
  return {
    "profile-1": { ...value["profile-1"] },
    "profile-2": { ...value["profile-2"] },
    "profile-3": { ...value["profile-3"] },
    "profile-4": { ...value["profile-4"] },
  };
}

export const scalePreferencesRepository =
  new InMemoryScalePreferencesRepository();
