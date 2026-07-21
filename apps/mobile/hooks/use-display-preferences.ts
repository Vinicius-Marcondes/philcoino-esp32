import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences,
  type DisplayPreferencesRepository,
} from "@/src/storage/display-preferences-repository";

export type DisplayPreferenceError = "load" | "save" | null;

export function useDisplayPreferences(
  repository: DisplayPreferencesRepository,
) {
  const [preferences, setPreferences] = useState<DisplayPreferences>(
    DEFAULT_DISPLAY_PREFERENCES,
  );
  const [error, setError] = useState<DisplayPreferenceError>(null);
  const [loading, setLoading] = useState(true);
  const saveGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    void repository
      .load()
      .then((stored) => {
        if (active) {
          setPreferences(stored);
          setError(null);
        }
      })
      .catch(() => {
        if (active) {
          setPreferences(DEFAULT_DISPLAY_PREFERENCES);
          setError("load");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [repository]);

  const setKeepScreenAwake = useCallback(
    async (keepScreenAwake: boolean) => {
      const generation = ++saveGeneration.current;
      const next = { keepScreenAwake };
      setPreferences(next);
      setError(null);
      try {
        await repository.save(next);
      } catch {
        if (saveGeneration.current === generation) {
          setPreferences(DEFAULT_DISPLAY_PREFERENCES);
          setError("save");
        }
      }
    },
    [repository],
  );

  return {
    error,
    loading,
    preferences,
    setKeepScreenAwake,
  };
}
