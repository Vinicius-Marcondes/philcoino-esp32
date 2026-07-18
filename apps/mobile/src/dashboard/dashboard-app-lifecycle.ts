import type { AppStateStatus } from "react-native";

export type DashboardFreshness = "connecting" | "live" | "refreshing";

interface PollingLifecycleControl {
  pause(): void;
  resume(): void;
  start(): void;
  stop(): void;
}

type MutationLifecycleControl = PollingLifecycleControl;

interface DashboardAppLifecycleOptions {
  mutations: MutationLifecycleControl;
  onFreshnessChange: (freshness: DashboardFreshness) => void;
  polling: PollingLifecycleControl;
}

export class DashboardAppLifecycle {
  private readonly mutations: MutationLifecycleControl;
  private readonly onFreshnessChange: (freshness: DashboardFreshness) => void;
  private readonly polling: PollingLifecycleControl;

  private foreground = false;
  private started = false;

  constructor(options: DashboardAppLifecycleOptions) {
    this.mutations = options.mutations;
    this.onFreshnessChange = options.onFreshnessChange;
    this.polling = options.polling;
  }

  synchronize(appState: AppStateStatus): void {
    if (appState === "active") {
      if (!this.started) {
        this.started = true;
        this.foreground = true;
        this.onFreshnessChange("connecting");
        this.mutations.start();
        this.polling.start();
        return;
      }

      if (!this.foreground) {
        this.foreground = true;
        this.onFreshnessChange("refreshing");
        this.polling.resume();
      }
      return;
    }

    if (!this.started || !this.foreground) {
      return;
    }

    this.foreground = false;
    this.onFreshnessChange("refreshing");
    this.mutations.pause();
    this.polling.pause();
  }

  handleFreshSnapshot(): void {
    if (!this.started || !this.foreground) {
      return;
    }

    this.mutations.resume();
    this.onFreshnessChange("live");
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.foreground = false;
    this.mutations.stop();
    this.polling.stop();
  }
}
