import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  normalizeOtaOrigin,
  pairForFirmwareUpdate,
  uploadFirmwareImage,
} from "./ota-client.ts";

const defaultImage = fileURLToPath(new URL(
  "../../../firmware/espresso-machine/build/philcoino_espresso.bin",
  import.meta.url,
));

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(
      "bun run firmware:ota -- --origin https://philcoino-XXXXXX.local [--file path/to/philcoino_espresso.bin]",
    );
    return;
  }
  if (options.origin === null) {
    throw new Error("Missing --origin (for example https://philcoino-9EA3E4.local)." );
  }
  const origin = normalizeOtaOrigin(options.origin);
  const image = new Uint8Array(await readFile(options.file));
  console.log("OTA client: known-size-upload-v8");
  const credential = await pairWithRetry(origin);
  console.log(`Authenticated ${credential.deviceId}; uploading ${image.length} bytes...`);
  let reportedPercent = -1;
  const result = await uploadFirmwareImage(
    origin,
    image,
    credential,
    undefined,
    (sent, total) => {
      const percent = Math.floor((sent * 100) / total);
      if (percent >= reportedPercent + 10 || percent === 100) {
        reportedPercent = percent;
        process.stdout.write(`\rUpload ${percent}%`);
      }
    },
  );
  process.stdout.write("\n");
  console.log(
    `ESP32 accepted ${result.bytesWritten} bytes and is rebooting into the rollback-protected slot.`,
  );
}

async function pairWithRetry(origin: string) {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const pairingCode = await readPairingCode();
    console.log(`Pairing with ${origin}...`);
    try {
      return await pairForFirmwareUpdate(
        origin,
        pairingCode,
        undefined,
        (stage, detail) => console.log(`[pairing/${stage}] ${detail}`),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("invalid_pairing_code") || attempt === maximumAttempts) {
        throw error;
      }
      console.error(
        `Pairing code rejected. Re-enter all eight digits (${maximumAttempts - attempt} attempts remaining).`,
      );
    }
  }
  throw new Error("The pairing code was rejected.");
}

function parseArguments(values: string[]): {
  file: string;
  help: boolean;
  origin: string | null;
} {
  let file = defaultImage;
  let origin: string | null = null;
  let help = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      help = true;
    } else if (value === "--origin") {
      origin = values[++index] ?? null;
    } else if (value === "--file") {
      file = values[++index] ?? "";
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (file === "") throw new Error("--file requires a path.");
  return { file, help, origin };
}

async function readPairingCode(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY ||
      typeof process.stdin.setRawMode !== "function") {
    throw new Error("The eight-digit pairing code must be entered from an interactive terminal.");
  }
  process.stdout.write("Pairing code (8 digits): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let digits = "";
    const restore = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      if (text.includes("\u0003")) {
        restore();
        reject(new Error("OTA upload cancelled."));
        return;
      }
      for (const character of text) {
        if (character === "\u007f" || character === "\b") {
          if (digits.length > 0) {
            digits = digits.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (character >= "0" && character <= "9" && digits.length < 8) {
          digits += character;
          process.stdout.write("*");
        } else if ((character === "\r" || character === "\n") && digits.length === 8) {
          restore();
          resolve(digits);
          return;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OTA failed: ${message}`);
  process.exitCode = 1;
});
