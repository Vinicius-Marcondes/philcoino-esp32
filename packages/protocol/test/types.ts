import type {
  ExtractionTelemetryCursor,
  MachineStateV3,
  PairingSessionStartResponse,
  PairingCompleteResponse,
} from "../src/index.ts";

const cursor: ExtractionTelemetryCursor = {
  extractionId: "extraction-0001",
  bootId: "00000000000000000000000000000001",
  afterSequence: 16,
};

export function acceptsV3Types(
  state: MachineStateV3,
  session: PairingSessionStartResponse,
  complete: PairingCompleteResponse,
): [MachineStateV3, ExtractionTelemetryCursor, string, string] {
  return [state, cursor, session.serverPublicKey, complete.accessToken];
}
