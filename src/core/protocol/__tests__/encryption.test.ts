/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import {
  setupCipher,
  encryptPacket,
  decryptPacket,
  paddingForSize,
  buildCipherCaps,
} from "../encryption";
import type { CipherCaps } from "../types";
import type { CipherState } from "../encryption";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaps(overrides: Partial<CipherCaps> = {}): CipherCaps {
  return {
    cipher: "AES",
    mode: "CBC",
    iv: crypto.getRandomValues(new Uint8Array(16)),
    key_salt: crypto.getRandomValues(new Uint8Array(64)),
    key_size: 32,
    key_hash: "SHA-1",
    key_stretch: "PBKDF2",
    key_stretch_iterations: 1000,
    ...overrides,
  };
}

const TEST_KEY = "supersecretpassword123";

// ---------------------------------------------------------------------------
// setupCipher
// ---------------------------------------------------------------------------

describe("setupCipher", () => {
  it("derives an AES-CBC key with valid caps", async () => {
    const caps = makeCaps({ mode: "CBC" });
    const state = await setupCipher(caps, TEST_KEY, "encrypt");

    expect(state.blockSize).toBe(16);
    expect(state.key).toBeInstanceOf(CryptoKey);
    expect(state.params.name).toBe("AES-CBC");
  });

  it("derives an AES-GCM key with valid caps", async () => {
    const caps = makeCaps({ mode: "GCM" });
    const state = await setupCipher(caps, TEST_KEY, "encrypt");

    expect(state.blockSize).toBe(0);
    expect(state.key).toBeInstanceOf(CryptoKey);
    expect(state.params.name).toBe("AES-GCM");
  });

  it("derives an AES-CTR key with valid caps", async () => {
    const caps = makeCaps({ mode: "CTR" });
    const state = await setupCipher(caps, TEST_KEY, "encrypt");

    expect(state.blockSize).toBe(0);
    expect(state.key).toBeInstanceOf(CryptoKey);
    expect(state.params.name).toBe("AES-CTR");
    expect((state.params as AesCtrParams).counter).toBeDefined();
  });

  it("throws on empty key", async () => {
    await expect(setupCipher(makeCaps(), "", "encrypt")).rejects.toThrow(
      "missing encryption key",
    );
  });

  it("throws on unsupported cipher", async () => {
    await expect(
      setupCipher(makeCaps({ cipher: "DES" }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("unsupported encryption cipher");
  });

  it("throws on unsupported mode", async () => {
    await expect(
      setupCipher(makeCaps({ mode: "ECB" }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("unsupported AES mode");
  });

  it("throws on missing IV", async () => {
    await expect(
      setupCipher(makeCaps({ iv: undefined }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("missing IV");
  });

  it("throws on missing salt", async () => {
    await expect(
      setupCipher(makeCaps({ key_salt: undefined }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("missing salt");
  });

  it("throws on too few iterations", async () => {
    await expect(
      setupCipher(makeCaps({ key_stretch_iterations: 500 }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("invalid number of iterations");
  });

  it("throws on too many iterations", async () => {
    await expect(
      setupCipher(makeCaps({ key_stretch_iterations: 2_000_000 }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("invalid number of iterations");
  });

  it("throws on invalid key size", async () => {
    await expect(
      setupCipher(makeCaps({ key_size: 64 }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("invalid key size");
  });

  it("throws on unsupported key stretch", async () => {
    await expect(
      setupCipher(makeCaps({ key_stretch: "scrypt" }), TEST_KEY, "encrypt"),
    ).rejects.toThrow("invalid key stretching function");
  });

  it("normalizes SHA hash names (SHA256 → SHA-256)", async () => {
    const caps = makeCaps({ key_hash: "SHA256" });
    const state = await setupCipher(caps, TEST_KEY, "encrypt");
    expect(state.key).toBeInstanceOf(CryptoKey);
  });

  it("accepts key_size 16 (AES-128)", async () => {
    const caps = makeCaps({ key_size: 16 });
    const state = await setupCipher(caps, TEST_KEY, "encrypt");
    expect(state.key).toBeInstanceOf(CryptoKey);
  });

  it("accepts key_size 24 (AES-192)", async () => {
    const caps = makeCaps({ key_size: 24 });
    const state = await setupCipher(caps, TEST_KEY, "encrypt");
    expect(state.key).toBeInstanceOf(CryptoKey);
  });
});

// ---------------------------------------------------------------------------
// encryptPacket / decryptPacket round-trip
// ---------------------------------------------------------------------------

describe("encrypt/decrypt round-trip", () => {
  const PLAINTEXT = new TextEncoder().encode("Hello, Xpra encryption!");

  async function makeStatePair(
    mode: string,
  ): Promise<{ encState: CipherState; decState: CipherState }> {
    const caps = makeCaps({ mode });
    const encState = await setupCipher(caps, TEST_KEY, "encrypt");
    const decState = await setupCipher(caps, TEST_KEY, "decrypt");
    return { encState, decState };
  }

  it("CBC round-trip", async () => {
    const { encState, decState } = await makeStatePair("CBC");
    const encrypted = await encryptPacket(encState, PLAINTEXT);

    expect(encrypted.length).toBeGreaterThan(PLAINTEXT.length);
    // First 16 bytes are the IV
    expect(encrypted.length).toBeGreaterThanOrEqual(16);

    const decrypted = await decryptPacket(decState, encrypted, PLAINTEXT.length);
    expect(decrypted).toEqual(PLAINTEXT);
  });

  it("GCM round-trip", async () => {
    const { encState, decState } = await makeStatePair("GCM");
    const encrypted = await encryptPacket(encState, PLAINTEXT);
    const decrypted = await decryptPacket(decState, encrypted, PLAINTEXT.length);
    expect(decrypted).toEqual(PLAINTEXT);
  });

  it("CTR round-trip", async () => {
    const { encState, decState } = await makeStatePair("CTR");
    const encrypted = await encryptPacket(encState, PLAINTEXT);
    const decrypted = await decryptPacket(decState, encrypted, PLAINTEXT.length);
    expect(decrypted).toEqual(PLAINTEXT);
  });

  it("encrypted output differs from plaintext", async () => {
    const { encState } = await makeStatePair("CBC");
    const encrypted = await encryptPacket(encState, PLAINTEXT);
    const ciphertext = encrypted.slice(16);
    expect(ciphertext).not.toEqual(PLAINTEXT);
  });

  it("different encryptions produce different IVs", async () => {
    const { encState } = await makeStatePair("CBC");
    const enc1 = await encryptPacket(encState, PLAINTEXT);
    const enc2 = await encryptPacket(encState, PLAINTEXT);

    const iv1 = enc1.slice(0, 16);
    const iv2 = enc2.slice(0, 16);
    expect(iv1).not.toEqual(iv2);
  });

  it("decryption fails with wrong key", async () => {
    const caps = makeCaps({ mode: "CBC" });
    const encState = await setupCipher(caps, TEST_KEY, "encrypt");
    const decState = await setupCipher(caps, "wrongpassword12345678", "decrypt");

    const encrypted = await encryptPacket(encState, PLAINTEXT);
    await expect(
      decryptPacket(decState, encrypted, PLAINTEXT.length),
    ).rejects.toThrow();
  });

  it("handles empty data", async () => {
    const { encState, decState } = await makeStatePair("GCM");
    const empty = new Uint8Array(0);
    const encrypted = await encryptPacket(encState, empty);
    const decrypted = await decryptPacket(decState, encrypted, 0);
    expect(decrypted).toEqual(empty);
  });

  it("handles large payloads", async () => {
    const { encState, decState } = await makeStatePair("CBC");
    const largeData = crypto.getRandomValues(new Uint8Array(65536));
    const encrypted = await encryptPacket(encState, largeData);
    const decrypted = await decryptPacket(decState, encrypted, largeData.length);
    expect(decrypted).toEqual(largeData);
  });
});

// ---------------------------------------------------------------------------
// paddingForSize
// ---------------------------------------------------------------------------

describe("paddingForSize", () => {
  it("returns full block when payload is block-aligned", () => {
    expect(paddingForSize(16, 32)).toBe(16);
  });

  it("returns partial padding for non-aligned payload", () => {
    expect(paddingForSize(16, 20)).toBe(12);
  });

  it("returns 0 when blockSize is 0 (GCM/CTR)", () => {
    expect(paddingForSize(0, 100)).toBe(0);
  });

  it("returns full block for size 0 (PKCS#7 always pads)", () => {
    expect(paddingForSize(16, 0)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// buildCipherCaps
// ---------------------------------------------------------------------------

describe("buildCipherCaps", () => {
  it("builds CBC caps from 'AES-CBC'", () => {
    const caps = buildCipherCaps("AES-CBC");

    expect(caps.cipher).toBe("AES");
    expect(caps.mode).toBe("CBC");
    expect(caps.key_size).toBe(32);
    expect(caps.key_hash).toBe("SHA1");
    expect(caps.key_stretch).toBe("PBKDF2");
    expect(caps.key_stretch_iterations).toBe(1000);
    expect(caps.iv).toBeInstanceOf(Uint8Array);
    expect((caps.iv as Uint8Array).length).toBe(16);
    expect(caps.key_salt).toBeInstanceOf(Uint8Array);
    expect((caps.key_salt as Uint8Array).length).toBe(64);
  });

  it("builds GCM caps from 'AES-GCM'", () => {
    const caps = buildCipherCaps("AES-GCM");
    expect(caps.mode).toBe("GCM");
  });

  it("defaults to CBC when no mode specified", () => {
    const caps = buildCipherCaps("AES");
    expect(caps.mode).toBe("CBC");
  });

  it("throws for non-AES encryption", () => {
    expect(() => buildCipherCaps("DES-CBC")).toThrow(
      "invalid encryption specified",
    );
  });

  it("generates unique IVs each call", () => {
    const caps1 = buildCipherCaps("AES-CBC");
    const caps2 = buildCipherCaps("AES-CBC");
    expect(caps1.iv).not.toEqual(caps2.iv);
  });

  it("generates unique salts each call", () => {
    const caps1 = buildCipherCaps("AES-CBC");
    const caps2 = buildCipherCaps("AES-CBC");
    expect(caps1.key_salt).not.toEqual(caps2.key_salt);
  });
});
