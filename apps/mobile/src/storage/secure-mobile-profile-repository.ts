import * as SecureStore from "expo-secure-store";

import {
  MobileProfileRepository,
  type ProfileKeyValueStore,
} from "./mobile-profile-repository";

const expoSecureStore: ProfileKeyValueStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
};

export const mobileProfileRepository = new MobileProfileRepository(
  expoSecureStore,
);
