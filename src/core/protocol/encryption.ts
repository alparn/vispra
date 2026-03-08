/*
 * Author: Ali Parnan
 *
 * AES-CBC/CTR/GCM encryption and decryption via the Web Crypto API.
 *
 * Extracted from the inline cipher logic in websocket.ts so that both
 * the main-thread transports and the protocol worker can share a single,
 * independently testable implementation.
 */

import type { CipherCaps } from "./types";
import { u8, getSecureRandomBytes } from "@/core/utils/crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CipherUsage = "encrypt" | "decrypt";

export interface CipherState {
  blockSize: number;
  params: AesCbcParams | AesCtrParams | AesGcmParams;
  key: CryptoKey;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IV_LENGTH = 16;

const SUPPORTED_KEY_SIZES = new Set([16, 24, 32]);
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 1_000_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive an AES CryptoKey from a password and the negotiated cipher
 * capabilities using PBKDF2, then return a ready-to-use {@link CipherState}.
 *
 * The returned `params` object already contains the base algorithm name
 * and length; callers must set a fresh `iv` before every encrypt/decrypt
 * operation.
 */
export async function setupCipher(
  caps: CipherCaps,
  key: string,
  usage: CipherUsage,
): Promise<CipherState> {
  if (!key) throw new Error("missing encryption key");

  const cipher = caps.cipher ?? "AES";
  if (cipher !== "AES") {
    throw new Error(`unsupported encryption cipher: '${cipher}'`);
  }

  const mode = caps.mode ?? "CBC";
  let blockSize = 0;
  if (mode === "CBC") {
    blockSize = 16;
  } else if (mode !== "GCM" && mode !== "CTR") {
    throw new Error(`unsupported AES mode '${mode}'`);
  }

  const iv = caps.iv;
  if (!iv) throw new Error("missing IV");

  const salt = caps.key_salt;
  if (!salt) throw new Error("missing salt");

  const iterations = caps.key_stretch_iterations ?? 0;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error(`invalid number of iterations: ${iterations}`);
  }

  const keySize = caps.key_size ?? 32;
  if (!SUPPORTED_KEY_SIZES.has(keySize)) {
    throw new Error(`invalid key size '${keySize}'`);
  }

  const keyStretch = caps.key_stretch ?? "PBKDF2";
  if (keyStretch.toUpperCase() !== "PBKDF2") {
    throw new Error(`invalid key stretching function '${keyStretch}'`);
  }

  const keyHash = normalizeHashName(caps.key_hash ?? "SHA-1");
  const aesName = `AES-${mode}`;

  const params = buildBaseParams(aesName, u8(iv));

  const saltU8 = u8(salt);
  const keyU8 = u8(key);

  const imported = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyU8),
    { name: "PBKDF2" },
    false,
    ["deriveKey", "deriveBits"],
  );

  const cryptoKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(saltU8),
      iterations,
      hash: { name: keyHash },
    },
    imported,
    { name: aesName, length: keySize * 8 },
    false,
    [usage],
  );

  return { blockSize, params, key: cryptoKey };
}

/**
 * Encrypt `data` using the given cipher state.
 *
 * Returns `iv || ciphertext` — a fresh random 16-byte IV is prepended to
 * the encrypted payload so the receiver can extract it.
 */
export async function encryptPacket(
  state: CipherState,
  data: Uint8Array,
): Promise<Uint8Array> {
  const iv = getSecureRandomBytes(IV_LENGTH);
  const params = { ...state.params, iv };

  const encrypted = await crypto.subtle.encrypt(
    params,
    state.key,
    toArrayBuffer(data),
  );

  const encU8 = new Uint8Array(encrypted);
  const combined = new Uint8Array(iv.byteLength + encU8.byteLength);
  combined.set(iv, 0);
  combined.set(encU8, iv.byteLength);
  return combined;
}

/**
 * Decrypt an incoming encrypted payload.
 *
 * Expects the format `iv (16 bytes) || ciphertext`.
 *
 * @param expectedPlainSize  The original (unpadded) payload size from the
 *   packet header, used to strip PKCS#7 padding for CBC mode.
 */
export async function decryptPacket(
  state: CipherState,
  data: Uint8Array,
  expectedPlainSize: number,
): Promise<Uint8Array> {
  const iv = data.slice(0, IV_LENGTH);
  const encryptedData = data.subarray(IV_LENGTH);
  const params = { ...state.params, iv };

  const decrypted = await crypto.subtle.decrypt(
    params,
    state.key,
    toArrayBuffer(encryptedData),
  );

  if (!decrypted || decrypted.byteLength < expectedPlainSize) {
    throw new Error(
      `expected ${expectedPlainSize} decrypted bytes, got ${decrypted.byteLength}`,
    );
  }

  return decrypted.byteLength === expectedPlainSize
    ? new Uint8Array(decrypted)
    : new Uint8Array(decrypted.slice(0, expectedPlainSize));
}

/**
 * Compute the PKCS#7 padding that the receiver must account for when an
 * encrypted payload is read from the wire.
 *
 * Returns `0` when the cipher mode does not use block padding (GCM, CTR).
 */
export function paddingForSize(blockSize: number, payloadSize: number): number {
  if (blockSize <= 0) return 0;
  return blockSize - (payloadSize % blockSize);
}

/**
 * Build the client-side cipher capabilities object that is sent to the
 * server during the hello handshake when encryption is negotiated.
 */
export function buildCipherCaps(encryption: string): CipherCaps {
  const parts = encryption.split("-");
  const enc = parts[0];
  if (enc !== "AES") {
    throw new Error(`invalid encryption specified: '${enc}'`);
  }
  const mode = parts[1] || "CBC";

  return {
    cipher: enc,
    mode,
    iv: getSecureRandomBytes(IV_LENGTH),
    key_salt: getSecureRandomBytes(64),
    key_size: 32,
    key_hash: "SHA1",
    key_stretch: "PBKDF2",
    key_stretch_iterations: 1000,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Ensure a Uint8Array is backed by a standalone ArrayBuffer (not a view
 * into a larger SharedArrayBuffer or offset buffer). Web Crypto APIs
 * require a plain ArrayBuffer in some environments.
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }
  return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function normalizeHashName(hash: string): string {
  let h = hash.toUpperCase();
  if (h.startsWith("SHA") && !h.startsWith("SHA-")) {
    h = "SHA-" + h.substring(3);
  }
  return h;
}

function buildBaseParams(
  aesName: string,
  iv: Uint8Array,
): AesCbcParams | AesCtrParams | AesGcmParams {
  if (aesName === "AES-CTR") {
    return {
      name: aesName,
      counter: iv,
      length: 64,
    } as AesCtrParams;
  }
  return {
    name: aesName,
    iv,
  } as AesCbcParams | AesGcmParams;
}
