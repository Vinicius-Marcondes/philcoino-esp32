import type { ProfileSlotId, WeightControl } from "@philcoino/protocol";

import {
  defaultScaleProfileDefaults,
  type ScalePreferencesRepository,
  type ScaleProfileDefaults,
} from "./scale-preferences";

export {
  DEFAULT_WEIGHT_CONTROL,
  defaultScaleProfileDefaults,
  type ScalePreferencesRepository,
  type ScaleProfileDefaults,
} from "./scale-preferences";

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
