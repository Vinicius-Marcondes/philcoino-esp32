import * as SecureStore from "expo-secure-store";
import {
  WeightControlSchema,
  type ProfileSlotId,
  type WeightControl,
} from "@philcoino/protocol";

import {
  defaultScaleProfileDefaults,
  type ScalePreferencesRepository,
  type ScaleProfileDefaults,
} from "./scale-preferences-repository";

const PREFIX = "philcoino.scale-defaults.";

class SecureScalePreferencesRepository
  implements ScalePreferencesRepository
{
  async load(deviceId: string): Promise<ScaleProfileDefaults> {
    const fallback = defaultScaleProfileDefaults();
    const value = await SecureStore.getItemAsync(`${PREFIX}${deviceId}`);
    if (value === null) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      for (const profileId of Object.keys(fallback) as ProfileSlotId[]) {
        const result = WeightControlSchema.safeParse(parsed[profileId]);
        if (!result.success) {
          return fallback;
        }
        fallback[profileId] = result.data;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  async save(
    deviceId: string,
    profileId: ProfileSlotId,
    value: WeightControl,
  ): Promise<ScaleProfileDefaults> {
    const current = await this.load(deviceId);
    current[profileId] = WeightControlSchema.parse(value);
    await SecureStore.setItemAsync(
      `${PREFIX}${deviceId}`,
      JSON.stringify(current),
    );
    return current;
  }
}

export const scalePreferencesRepository =
  new SecureScalePreferencesRepository();
