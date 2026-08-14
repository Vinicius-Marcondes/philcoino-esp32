const N = BigInt(
  "0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
);
const G = 5n;
const GROUP_BYTES = 384;
const USERNAME = "philcoino-v3";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RandomBytes = (length: number) => Uint8Array;

export class SrpServerSession {
  private readonly ABytes: Uint8Array;
  private readonly BBytes: Uint8Array;
  private readonly key: Uint8Array;
  private readonly sessionKey: Uint8Array;
  private readonly expectedClientProof: Uint8Array;
  readonly salt: Uint8Array;

  private constructor(values: {
    ABytes: Uint8Array;
    BBytes: Uint8Array;
    expectedClientProof: Uint8Array;
    key: Uint8Array;
    sessionKey: Uint8Array;
    salt: Uint8Array;
  }) {
    this.ABytes = values.ABytes;
    this.BBytes = values.BBytes;
    this.expectedClientProof = values.expectedClientProof;
    this.key = values.key;
    this.sessionKey = values.sessionKey;
    this.salt = values.salt;
  }

  static async create(
    pairingCode: string,
    clientPublicKey: Uint8Array,
    randomBytes: RandomBytes,
  ): Promise<SrpServerSession> {
    if (!/^[0-9]{8}$/u.test(pairingCode) || clientPublicKey.length !== GROUP_BYTES) {
      throw new Error("Invalid SRP parameters.");
    }
    const A = bytesToBigInt(clientPublicKey);
    if (A % N === 0n) throw new Error("Invalid SRP public key.");
    const salt = randomNonZero(randomBytes, 16);
    const b = nonZeroBigInt(randomBytes(32));
    const x = bytesToBigInt(await hash(
      salt,
      await hash(encoder.encode(`${USERNAME}:${pairingCode}`)),
    ));
    const verifier = modPow(G, x, N);
    const k = bytesToBigInt(await hash(bigIntToBytes(N), pad(bigIntToBytes(G))));
    const B = (k * verifier + modPow(G, b, N)) % N;
    const BBytes = bigIntToBytes(B);
    const u = bytesToBigInt(await hash(pad(clientPublicKey), pad(BBytes)));
    const shared = modPow(
      (A * modPow(verifier, u, N)) % N,
      b,
      N,
    );
    const sessionKey = await hash(bigIntToBytes(shared));
    const expectedClientProof = await evidence(
      salt,
      clientPublicKey,
      BBytes,
      sessionKey,
    );
    return new SrpServerSession({
      ABytes: clientPublicKey,
      BBytes,
      expectedClientProof,
      key: sessionKey.slice(0, 32),
      sessionKey,
      salt,
    });
  }

  get serverPublicKey(): Uint8Array {
    return this.BBytes.slice();
  }

  async verify(clientProof: Uint8Array): Promise<Uint8Array | null> {
    if (!constantTimeEqual(clientProof, this.expectedClientProof)) return null;
    return hash(this.ABytes, this.expectedClientProof, this.sessionKey);
  }

  async encrypt(nonce: Uint8Array, plaintext: string): Promise<Uint8Array> {
    return aesGcmEncrypt(this.key, nonce, encoder.encode(plaintext));
  }

  async decrypt(nonce: Uint8Array, ciphertext: Uint8Array): Promise<string> {
    return decoder.decode(await aesGcmDecrypt(this.key, nonce, ciphertext));
  }

}

export class SrpClientSession {
  readonly publicKey: Uint8Array;
  private readonly a: bigint;
  private readonly pairingCode: string;
  private key: Uint8Array | null = null;
  private expectedServerProof: Uint8Array | null = null;
  private nonce: Uint8Array | null = null;

  constructor(pairingCode: string, randomBytes: RandomBytes = secureRandom) {
    if (!/^[0-9]{8}$/u.test(pairingCode)) throw new Error("Invalid pairing code.");
    this.pairingCode = pairingCode;
    this.a = nonZeroBigInt(randomBytes(32));
    this.publicKey = pad(bigIntToBytes(modPow(G, this.a, N)));
  }

  async processChallenge(
    salt: Uint8Array,
    serverPublicKey: Uint8Array,
  ): Promise<Uint8Array> {
    const B = bytesToBigInt(serverPublicKey);
    if (B % N === 0n) throw new Error("Invalid server public key.");
    const x = bytesToBigInt(await hash(
      salt,
      await hash(encoder.encode(`${USERNAME}:${this.pairingCode}`)),
    ));
    const k = bytesToBigInt(await hash(bigIntToBytes(N), pad(bigIntToBytes(G))));
    const u = bytesToBigInt(await hash(this.publicKey, pad(serverPublicKey)));
    const verifier = modPow(G, x, N);
    const base = (B + N - (k * verifier) % N) % N;
    const shared = modPow(base, this.a + u * x, N);
    const sessionKey = await hash(bigIntToBytes(shared));
    const proof = await evidence(salt, this.publicKey, serverPublicKey, sessionKey);
    this.expectedServerProof = await hash(this.publicKey, proof, sessionKey);
    this.key = sessionKey.slice(0, 32);
    return proof;
  }

  verifyServer(serverProof: Uint8Array, deviceNonce: Uint8Array): boolean {
    if (
      this.expectedServerProof === null ||
      !constantTimeEqual(serverProof, this.expectedServerProof) ||
      deviceNonce.length !== 12 ||
      !constantTimeEqual(deviceNonce.slice(8), new Uint8Array([0, 0, 0, 1]))
    ) {
      return false;
    }
    this.nonce = deviceNonce.slice();
    return true;
  }

  async decrypt(ciphertext: Uint8Array): Promise<string> {
    if (this.key === null || this.nonce === null) throw new Error("SRP is not verified.");
    const value = decoder.decode(await aesGcmDecrypt(this.key, this.nonce, ciphertext));
    this.nonce = incrementNonce(this.nonce);
    return value;
  }

  async encrypt(plaintext: string): Promise<Uint8Array> {
    if (this.key === null || this.nonce === null) throw new Error("SRP is not verified.");
    const value = await aesGcmEncrypt(this.key, this.nonce, encoder.encode(plaintext));
    this.nonce = incrementNonce(this.nonce);
    return value;
  }
}

async function evidence(
  salt: Uint8Array,
  A: Uint8Array,
  B: Uint8Array,
  sessionKey: Uint8Array,
): Promise<Uint8Array> {
  const hashN = await hash(bigIntToBytes(N));
  const hashG = await hash(pad(bigIntToBytes(G)));
  const xor = hashN.map((byte, index) => byte ^ hashG[index]);
  return hash(
    xor,
    await hash(encoder.encode(USERNAME)),
    salt,
    A,
    B,
    sessionKey,
  );
}

async function hash(...values: Uint8Array[]): Promise<Uint8Array> {
  const bytes = concatenate(...values);
  return new Uint8Array(await crypto.subtle.digest("SHA-512", arrayBuffer(bytes)));
}

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  return new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(nonce), tagLength: 128 },
    key,
    arrayBuffer(plaintext),
  ));
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(nonce), tagLength: 128 },
    key,
    arrayBuffer(ciphertext),
  ));
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

export function incrementNonce(value: Uint8Array): Uint8Array {
  if (value.length !== 12) throw new Error("Invalid AES-GCM nonce.");
  const result = value.slice();
  let counter = 0;
  for (let index = 8; index < 12; index += 1) {
    counter = counter * 256 + result[index];
  }
  if (counter >= 0xffff_ffff) throw new Error("AES-GCM nonce exhausted.");
  counter += 1;
  for (let index = 11; index >= 8; index -= 1) {
    result[index] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  return result;
}

function pad(value: Uint8Array): Uint8Array {
  if (value.length > GROUP_BYTES) throw new Error("SRP value is too large.");
  const output = new Uint8Array(GROUP_BYTES);
  output.set(value, GROUP_BYTES - value.length);
  return output;
}

function bigIntToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToBigInt(value: Uint8Array): bigint {
  if (value.length === 0) return 0n;
  return BigInt(`0x${[...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function concatenate(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function randomNonZero(randomBytes: RandomBytes, length: number): Uint8Array {
  const value = randomBytes(length);
  if (value.length !== length) throw new Error("Invalid random source.");
  if (value[0] === 0) value[0] = 1;
  return value;
}

function nonZeroBigInt(value: Uint8Array): bigint {
  const result = bytesToBigInt(value);
  return result === 0n ? 1n : result;
}

function secureRandom(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
