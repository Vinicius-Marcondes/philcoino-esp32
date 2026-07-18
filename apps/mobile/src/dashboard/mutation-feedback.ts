import type { DashboardMutationStatus } from "./dashboard-mutation-session";

export const MUTATION_FEEDBACK_DISMISS_MS = 5_000;

export type MutationFeedbackVisibility = "all" | "errors-only";

export function mutationFeedbackIsVisible(
  status: DashboardMutationStatus,
  visibility: MutationFeedbackVisibility,
): boolean {
  if (status === "idle") {
    return false;
  }

  return (
    visibility === "all" ||
    status === "rejected" ||
    status === "disconnected"
  );
}

export function mutationFeedbackShouldAutoDismiss(
  status: DashboardMutationStatus,
): boolean {
  return (
    status === "acknowledged" ||
    status === "rejected" ||
    status === "disconnected"
  );
}
