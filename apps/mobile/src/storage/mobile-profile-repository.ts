import { ProfileSetSchema, type ProfileSet } from "@philcoino/protocol";

import {
  cloneProfileSet,
  DEFAULT_MOBILE_PROFILE_SET,
} from "../profiles/profile-set";

const MOBILE_PROFILES_KEY = "philcoino.mobile-profiles.v2";

export interface ProfileKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export class MobileProfileRepository {
  constructor(private readonly store: ProfileKeyValueStore) {}

  async load(): Promise<ProfileSet> {
    const stored = await this.store.getItemAsync(MOBILE_PROFILES_KEY);
    if (stored === null) {
      const seeded = cloneProfileSet(DEFAULT_MOBILE_PROFILE_SET);
      await this.save(seeded);
      return seeded;
    }

    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      throw new Error("The stored mobile profile set is invalid.");
    }
    const parsed = ProfileSetSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("The stored mobile profile set is invalid.");
    }
    return cloneProfileSet(parsed.data);
  }

  async save(profiles: ProfileSet): Promise<void> {
    const parsed = ProfileSetSchema.safeParse(profiles);
    if (!parsed.success) {
      throw new Error("The mobile profile set is invalid.");
    }
    await this.store.setItemAsync(
      MOBILE_PROFILES_KEY,
      JSON.stringify(parsed.data),
    );
  }
}
