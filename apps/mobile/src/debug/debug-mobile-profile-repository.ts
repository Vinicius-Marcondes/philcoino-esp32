import { MobileProfileRepository } from "../storage/mobile-profile-repository";

let storedProfiles: string | null = null;

export const debugMobileProfileRepository = new MobileProfileRepository({
  async getItemAsync() {
    return storedProfiles;
  },
  async setItemAsync(_key, value) {
    storedProfiles = value;
  },
});
