const DISPLAY_PREFERENCES_KEY = "philcoino.display-preferences.v1";

export interface DisplayPreferences {
  keepScreenAwake: boolean;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  keepScreenAwake: false,
};

export interface DisplayPreferencesStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class DisplayPreferencesRepository {
  constructor(private readonly store: DisplayPreferencesStore) {}

  async load(): Promise<DisplayPreferences> {
    const stored = this.store.getItem(DISPLAY_PREFERENCES_KEY);
    if (stored === null) {
      return { ...DEFAULT_DISPLAY_PREFERENCES };
    }

    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      throw new Error("The stored display preferences are invalid.");
    }
    if (!isDisplayPreferences(value)) {
      throw new Error("The stored display preferences are invalid.");
    }
    return { ...value };
  }

  async save(preferences: DisplayPreferences): Promise<void> {
    if (!isDisplayPreferences(preferences)) {
      throw new Error("The display preferences are invalid.");
    }
    this.store.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify(preferences));
  }
}

function isDisplayPreferences(value: unknown): value is DisplayPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.keepScreenAwake === "boolean"
  );
}
