import type { ProfileSet } from "@philcoino/protocol";

import type { DashboardStateClient } from "../dashboard/dashboard-polling-session";
import type { MobileProfileRepository } from "../storage/mobile-profile-repository";
import {
  idleProfileImportState,
  profileImportChanges,
  type ProfileImportState,
} from "./profile-import";
import { cloneProfileSet } from "./profile-set";

interface ProfileSynchronizationSessionOptions {
  client: Pick<DashboardStateClient, "getProfiles">;
  onImportStateChange: (state: ProfileImportState) => void;
  onLocalErrorChange: (failed: boolean) => void;
  onMachineErrorChange: (failed: boolean) => void;
  onMachineProfilesChange: (profiles: ProfileSet) => void;
  onMobileProfilesChange: (profiles: ProfileSet) => void;
  onWritePendingChange: (pending: boolean) => void;
  repository: MobileProfileRepository;
}

export class ProfileSynchronizationSession {
  private readonly client: Pick<DashboardStateClient, "getProfiles">;
  private readonly onImportStateChange: (state: ProfileImportState) => void;
  private readonly onLocalErrorChange: (failed: boolean) => void;
  private readonly onMachineErrorChange: (failed: boolean) => void;
  private readonly onMachineProfilesChange: (profiles: ProfileSet) => void;
  private readonly onMobileProfilesChange: (profiles: ProfileSet) => void;
  private readonly onWritePendingChange: (pending: boolean) => void;
  private readonly repository: MobileProfileRepository;

  private active = false;
  private generation = 0;
  private importGeneration = 0;
  private localProfiles: ProfileSet | null = null;
  private localRevision = 0;
  private latestRequestedRevision = 0;
  private lastPersistedProfiles: ProfileSet | null = null;
  private machineController: AbortController | null = null;
  private machineRequest: Promise<ProfileSet | null> | null = null;
  private paused = false;
  private pendingImport: ProfileSet | null = null;
  private pendingImportRevision: number | null = null;
  private pendingWrites = 0;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(options: ProfileSynchronizationSessionOptions) {
    this.client = options.client;
    this.onImportStateChange = options.onImportStateChange;
    this.onLocalErrorChange = options.onLocalErrorChange;
    this.onMachineErrorChange = options.onMachineErrorChange;
    this.onMachineProfilesChange = options.onMachineProfilesChange;
    this.onMobileProfilesChange = options.onMobileProfilesChange;
    this.onWritePendingChange = options.onWritePendingChange;
    this.repository = options.repository;
  }

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.paused = false;
    this.generation += 1;
    this.importGeneration += 1;
    this.onWritePendingChange(false);
    this.publishImport(idleProfileImportState);
    void this.loadLocalProfiles();
    void this.refreshMachineProfiles();
  }

  pause(): void {
    if (!this.active || this.paused) {
      return;
    }
    this.paused = true;
    this.machineController?.abort();
    this.importGeneration += 1;
    this.cancelImport();
  }

  resume(): void {
    if (!this.active || !this.paused) {
      return;
    }
    this.paused = false;
    void this.refreshMachineProfiles();
  }

  stop(): void {
    this.active = false;
    this.paused = false;
    this.generation += 1;
    this.importGeneration += 1;
    this.machineController?.abort();
    this.machineController = null;
    this.machineRequest = null;
    this.pendingImport = null;
    this.pendingImportRevision = null;
  }

  handleConnectionLost(): void {
    this.machineController?.abort();
    this.cancelImport();
  }

  cancelImport(): void {
    this.importGeneration += 1;
    this.pendingImport = null;
    this.pendingImportRevision = null;
    this.publishImport(idleProfileImportState);
  }

  async refreshMachineProfiles(): Promise<ProfileSet | null> {
    if (!this.active || this.paused) {
      return null;
    }
    if (this.machineRequest !== null) {
      if (!this.machineController?.signal.aborted) {
        return this.machineRequest;
      }
      this.machineController = null;
      this.machineRequest = null;
    }

    const generation = this.generation;
    const controller = new AbortController();
    this.machineController = controller;
    const request = this.client
      .getProfiles({ signal: controller.signal })
      .then((profiles) => {
        if (!this.isCurrent(generation) || controller.signal.aborted) {
          return null;
        }
        const validated = cloneProfileSet(profiles);
        this.onMachineProfilesChange(validated);
        this.onMachineErrorChange(false);
        return validated;
      })
      .catch(() => {
        if (this.isCurrent(generation) && !controller.signal.aborted) {
          this.onMachineErrorChange(true);
        }
        return null;
      })
      .finally(() => {
        if (this.machineController === controller) {
          this.machineController = null;
        }
        if (this.machineRequest === request) {
          this.machineRequest = null;
        }
      });
    this.machineRequest = request;
    return request;
  }

  async requestImport(): Promise<void> {
    if (!this.active || this.paused) {
      return;
    }
    this.pendingImport = null;
    this.pendingImportRevision = null;
    const importGeneration = ++this.importGeneration;
    this.publishImport({ changes: [], outcome: null, status: "loading" });
    const machineProfiles = await this.refreshMachineProfiles();
    if (
      !this.active ||
      this.paused ||
      importGeneration !== this.importGeneration
    ) {
      return;
    }
    if (machineProfiles === null) {
      this.publishImport({
        changes: [],
        outcome: "machine-read-failed",
        status: "rejected",
      });
      return;
    }
    if (this.localProfiles === null) {
      this.publishImport({
        changes: [],
        outcome: "local-unavailable",
        status: "rejected",
      });
      return;
    }

    const changes = profileImportChanges(this.localProfiles, machineProfiles);
    if (changes.length === 0) {
      this.publishImport({
        changes: [],
        outcome: "already-matches",
        status: "acknowledged",
      });
      return;
    }

    this.pendingImport = cloneProfileSet(machineProfiles);
    this.pendingImportRevision = this.localRevision;
    this.publishImport({ changes, outcome: null, status: "reviewing" });
  }

  async confirmImport(): Promise<boolean> {
    if (
      this.pendingImport === null ||
      this.pendingImportRevision === null ||
      this.pendingImportRevision !== this.localRevision ||
      this.pendingWrites > 0
    ) {
      this.pendingImport = null;
      this.pendingImportRevision = null;
      this.publishImport({
        changes: [],
        outcome: "stale-review",
        status: "rejected",
      });
      return false;
    }

    const profiles = cloneProfileSet(this.pendingImport);
    const changes =
      this.localProfiles === null
        ? []
        : profileImportChanges(this.localProfiles, profiles);
    this.publishImport({ changes, outcome: null, status: "saving" });
    const saved = await this.enqueueLocalWrite(profiles, true);
    if (!this.active) {
      return saved;
    }
    if (saved) {
      this.pendingImport = null;
      this.pendingImportRevision = null;
      this.publishImport({
        changes: [],
        outcome: "imported",
        status: "acknowledged",
      });
    } else {
      this.pendingImportRevision = this.localRevision;
      this.publishImport({
        changes,
        outcome: "save-failed",
        status: "rejected",
      });
    }
    return saved;
  }

  saveLocalProfiles(profiles: ProfileSet): Promise<boolean> {
    return this.enqueueLocalWrite(profiles, false);
  }

  private async loadLocalProfiles(): Promise<void> {
    const generation = this.generation;
    try {
      const profiles = cloneProfileSet(await this.repository.load());
      if (!this.isCurrent(generation)) {
        return;
      }
      this.localProfiles = profiles;
      this.lastPersistedProfiles = profiles;
      this.localRevision += 1;
      this.latestRequestedRevision = this.localRevision;
      this.onMobileProfilesChange(cloneProfileSet(profiles));
      this.onLocalErrorChange(false);
    } catch {
      if (this.isCurrent(generation)) {
        this.onLocalErrorChange(true);
      }
    }
  }

  private enqueueLocalWrite(
    profiles: ProfileSet,
    preserveImport: boolean,
  ): Promise<boolean> {
    const candidate = cloneProfileSet(profiles);
    const revision = ++this.localRevision;
    this.latestRequestedRevision = revision;
    if (!preserveImport) {
      const reviewWasOpen = this.pendingImport !== null;
      this.importGeneration += 1;
      this.pendingImport = null;
      this.pendingImportRevision = null;
      if (reviewWasOpen) {
        this.publishImport({
          changes: [],
          outcome: "stale-review",
          status: "rejected",
        });
      }
    }
    this.pendingWrites += 1;
    this.onWritePendingChange(true);

    const operation = this.writeTail.then(async () => {
      try {
        await this.repository.save(candidate);
        this.lastPersistedProfiles = candidate;
        if (this.active && revision === this.latestRequestedRevision) {
          this.localProfiles = candidate;
          this.onMobileProfilesChange(cloneProfileSet(candidate));
          this.onLocalErrorChange(false);
        }
        return true;
      } catch {
        if (this.active && revision === this.latestRequestedRevision) {
          if (this.lastPersistedProfiles !== null) {
            this.localProfiles = this.lastPersistedProfiles;
            this.onMobileProfilesChange(
              cloneProfileSet(this.lastPersistedProfiles),
            );
          }
          this.onLocalErrorChange(true);
        }
        return false;
      } finally {
        this.pendingWrites -= 1;
        if (this.active && this.pendingWrites === 0) {
          this.onWritePendingChange(false);
        }
      }
    });
    this.writeTail = operation.then(() => undefined);
    return operation;
  }

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private publishImport(state: ProfileImportState): void {
    if (!this.active) {
      return;
    }
    this.onImportStateChange({
      ...state,
      changes: state.changes.map((change) => ({
        ...change,
        localProfile:
          change.localProfile === null ? null : { ...change.localProfile },
        machineProfile:
          change.machineProfile === null ? null : { ...change.machineProfile },
      })),
    });
  }
}
