import type { MobileProfileRepository } from "../storage/mobile-profile-repository";
import { cloneProfileSet, type ProfileSet } from "./profile-set";

interface MobileProfileSessionOptions {
  onLocalErrorChange: (failed: boolean) => void;
  onMobileProfilesChange: (profiles: ProfileSet) => void;
  onWritePendingChange: (pending: boolean) => void;
  repository: MobileProfileRepository;
}

export class MobileProfileSession {
  private readonly onLocalErrorChange: (failed: boolean) => void;
  private readonly onMobileProfilesChange: (profiles: ProfileSet) => void;
  private readonly onWritePendingChange: (pending: boolean) => void;
  private readonly repository: MobileProfileRepository;
  private active = false;
  private generation = 0;
  private latestRevision = 0;
  private pendingWrites = 0;
  private lastPersisted: ProfileSet | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(options: MobileProfileSessionOptions) {
    this.onLocalErrorChange = options.onLocalErrorChange;
    this.onMobileProfilesChange = options.onMobileProfilesChange;
    this.onWritePendingChange = options.onWritePendingChange;
    this.repository = options.repository;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    this.onWritePendingChange(false);
    void this.repository.load().then(
      (stored) => {
        if (!this.isCurrent(generation)) return;
        const profiles = cloneProfileSet(stored);
        this.lastPersisted = profiles;
        this.onMobileProfilesChange(cloneProfileSet(profiles));
        this.onLocalErrorChange(false);
      },
      () => {
        if (this.isCurrent(generation)) this.onLocalErrorChange(true);
      },
    );
  }

  stop(): void {
    this.active = false;
    this.generation += 1;
  }

  saveLocalProfiles(profiles: ProfileSet): Promise<boolean> {
    const candidate = cloneProfileSet(profiles);
    const revision = ++this.latestRevision;
    this.pendingWrites += 1;
    this.onWritePendingChange(true);
    const operation = this.writeTail.then(async () => {
      try {
        await this.repository.save(candidate);
        this.lastPersisted = candidate;
        if (this.active && revision === this.latestRevision) {
          this.onMobileProfilesChange(cloneProfileSet(candidate));
          this.onLocalErrorChange(false);
        }
        return true;
      } catch {
        if (this.active && revision === this.latestRevision) {
          if (this.lastPersisted !== null) {
            this.onMobileProfilesChange(cloneProfileSet(this.lastPersisted));
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
}
