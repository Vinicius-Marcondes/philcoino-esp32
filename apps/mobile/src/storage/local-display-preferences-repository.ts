import "expo-sqlite/localStorage/install";

import {
  DisplayPreferencesRepository,
  type DisplayPreferencesStore,
} from "./display-preferences-repository";

const localDisplayPreferencesStore: DisplayPreferencesStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

export const displayPreferencesRepository =
  new DisplayPreferencesRepository(localDisplayPreferencesStore);
