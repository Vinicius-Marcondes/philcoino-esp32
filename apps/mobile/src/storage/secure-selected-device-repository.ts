import * as SecureStore from "expo-secure-store";

import {
  SelectedDeviceRepository,
  type SecureKeyValueStore,
} from "./selected-device-repository";

const expoSecureStore: SecureKeyValueStore = {
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
};

export const selectedDeviceRepository = new SelectedDeviceRepository(
  expoSecureStore,
);
