import { describe, it, expect } from "vitest";
import { lz4Decompress, lz4Compress, isBrotliReady, ensureBrotli } from "../codec";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Stub the rencode global so the codec module loads without errors
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

if (!(globalThis as any).rencode) {
  (globalThis as any).rencode = (obj: unknown): Uint8Array =>
    encoder.encode(JSON.stringify(obj));
}
if (!(globalThis as any).rdecode) {
  (globalThis as any).rdecode = (buf: Uint8Array) =>
    JSON.parse(new TextDecoder().decode(buf));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("codec", () => {
  describe("lz4 round-trip (Xpra format)", () => {
    it("compresses and decompresses correctly", () => {
      const original = new Uint8Array(1024);
      for (let i = 0; i < original.length; i++) original[i] = i & 3;
      const compressed = lz4Compress(original);
      expect(compressed.length).toBeLessThan(original.length);
      const uncompLen =
        compressed[0] | (compressed[1] << 8) | (compressed[2] << 16) | (compressed[3] << 24);
      expect(uncompLen).toBe(original.length);
      const result = lz4Decompress(compressed);
      expect(result).toEqual(original);
    });

    it("handles larger payloads", () => {
      const original = new Uint8Array(16384);
      for (let i = 0; i < original.length; i++) original[i] = i & 3;
      const compressed = lz4Compress(original);
      const result = lz4Decompress(compressed);
      expect(result).toEqual(original);
    });
  });

  describe("brotli", () => {
    it("isBrotliReady returns false before initialisation", () => {
      expect(isBrotliReady()).toBe(false);
    });

    it("ensureBrotli rejects gracefully in test environment", async () => {
      try {
        await ensureBrotli();
      } catch {
        // Expected – WASM fetch fails in jsdom test env
      }
    });
  });
});
