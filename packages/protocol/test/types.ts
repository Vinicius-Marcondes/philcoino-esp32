import type {
  ExtractionTelemetryCursor,
  MachineStateV4,
  PairingSessionStartResponse,
  PairingCompleteResponse,
} from "../src/index.ts";

const cursor: ExtractionTelemetryCursor = {
  extractionId: "extraction-0001",
  bootId: "00000000000000000000000000000001",
  afterSequence: 16,
};

export function acceptsV4Types(
  state: MachineStateV4,
  session: PairingSessionStartResponse,
  complete: PairingCompleteResponse,
): [MachineStateV4, ExtractionTelemetryCursor, string, string] {
  return [state, cursor, session.serverPublicKey, complete.accessToken];
}
