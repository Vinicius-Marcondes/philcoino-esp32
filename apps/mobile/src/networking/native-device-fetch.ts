import { secureTransport } from "../../modules/philcoino-secure-transport/src";

import type { DeviceFetchResponse, FetchImplementation } from "./device-api-client";
import { createNativeRequestId } from "./native-request-id";
import { nativeTransportError } from "./native-transport-error";

export const nativeDeviceFetch: FetchImplementation = async (
  url,
  init,
): Promise<DeviceFetchResponse> => {
  if (init.signal.aborted) {
    throw new Error("The native device request was cancelled.");
  }
  const parsed = new URL(url);
  const pin = init.headers["X-Philcoino-SPKI-SHA256"];
  if (pin === undefined) {
    throw new TypeError("Pinned device requests require an SPKI fingerprint.");
  }
  const headers = { ...init.headers };
  delete headers["X-Philcoino-SPKI-SHA256"];

  if (headers.Accept === "text/event-stream") {
    const requestId = createNativeRequestId();
    let removeListener: (() => void) | null = null;
    const cancelNative = () => secureTransport.cancelSse(requestId);
    const cleanup = () => {
      removeListener?.();
      removeListener = null;
      init.signal.removeEventListener("abort", cancelNative);
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const subscription = secureTransport.addListener(
          "onSseEvent",
          (event) => {
            if (event.requestId !== requestId) return;
            if (event.type === "data") {
              controller.enqueue(new TextEncoder().encode(event.body ?? ""));
            } else if (event.type === "closed") {
              cleanup();
              controller.close();
            } else {
              cleanup();
              controller.error(new Error(event.body ?? "SSE disconnected"));
            }
          },
        );
        removeListener = () => subscription.remove();
        void secureTransport.startSse(requestId, {
          headers,
          method: init.method,
          origin: parsed.origin,
          path: parsed.pathname + parsed.search,
          pin,
          timeoutMs: 30_000,
        });
      },
      cancel() {
        cleanup();
        cancelNative();
      },
    });
    init.signal.addEventListener("abort", cancelNative, { once: true });
    return {
      body,
      json: async () => {
        throw new Error("SSE does not have a JSON response body.");
      },
      ok: true,
      status: 200,
    };
  }

  const requestId = createNativeRequestId();
  const cancel = () => secureTransport.cancelRequest(requestId);
  init.signal.addEventListener("abort", cancel, { once: true });
  let response;
  try {
    try {
      response = await secureTransport.request(requestId, {
        body: init.body,
        headers,
        method: init.method,
        origin: parsed.origin,
        path: parsed.pathname + parsed.search,
        pin,
        timeoutMs: 30_000,
      });
    } catch (error) {
      throw nativeTransportError(error, init.signal);
    }
  } finally {
    init.signal.removeEventListener("abort", cancel);
  }
  return {
    json: async () => JSON.parse(response.body) as unknown,
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
  };
};
