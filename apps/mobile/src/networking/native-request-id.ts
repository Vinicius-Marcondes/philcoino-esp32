let nextRequestSequence = 0;

/**
 * Creates a process-local identifier used only to match native requests with
 * cancellation and SSE callbacks. This is not a credential or wire nonce, so
 * it intentionally avoids browser crypto APIs that React Native does not
 * provide.
 */
export function createNativeRequestId(): string {
  nextRequestSequence += 1;
  return `native-${Date.now().toString(36)}-${nextRequestSequence.toString(36)}`;
}
