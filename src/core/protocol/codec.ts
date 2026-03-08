/*
 * Author: Ali Parnan
 *
 * Centralised codec wrapper for the Xpra wire protocol.
 *
 * Provides a single import point for rencode/rdecode, LZ4 compression /
 * decompression, and lazy Brotli decompression.  Both the main-thread
 * transports and the protocol worker import from here instead of
 * duplicating the initialisation logic.
 */

import {
  decompressBlock as lz4DecompressBlock,
  compressBlock as lz4CompressBlock,
  compressBound as lz4CompressBound,
} from "lz4js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// rencode / rdecode  (vendor global – see src/vendor/rencode.js / .d.ts)
// ---------------------------------------------------------------------------

declare function rencode(obj: unknown): Uint8Array;
declare function rdecode(buf: Uint8Array): any;

export { rencode, rdecode };

// ---------------------------------------------------------------------------
// LZ4 — Xpra uses raw LZ4 blocks with a 4-byte LE uncompressed-length prefix
// (not the LZ4 frame format).
// ---------------------------------------------------------------------------

/**
 * Decode Xpra LZ4 payload: 4-byte LE uncompressed length + raw LZ4 block.
 */
export function lz4Decompress(data: Uint8Array): Uint8Array {
  const length =
    data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  if (length <= 0 || length > 0x4000_0000) {
    throw new Error(`lz4: invalid uncompressed size: ${length}`);
  }
  const inflated = new Uint8Array(length);
  lz4DecompressBlock(data, inflated, 4, data.length - 4, 0);
  return inflated;
}

/**
 * Encode data into Xpra LZ4 format: 4-byte LE uncompressed length + raw LZ4 block.
 * Falls back to storing uncompressed data if LZ4 cannot compress (e.g. tiny inputs).
 */
export function lz4Compress(data: Uint8Array): Uint8Array {
  const maxOut = lz4CompressBound(data.length);
  const compBuf = new Uint8Array(maxOut);
  const hashTable = new Uint32Array(65536);
  const compressedLen = lz4CompressBlock(data, compBuf, 0, data.length, hashTable);

  let payload: Uint8Array;
  let payloadLen: number;
  if (compressedLen === 0 || compressedLen >= data.length) {
    payload = data;
    payloadLen = data.length;
  } else {
    payload = compBuf.subarray(0, compressedLen);
    payloadLen = compressedLen;
  }

  const result = new Uint8Array(4 + payloadLen);
  result[0] = data.length & 0xff;
  result[1] = (data.length >>> 8) & 0xff;
  result[2] = (data.length >>> 16) & 0xff;
  result[3] = (data.length >>> 24) & 0xff;
  result.set(payload, 4);
  return result;
}

// ---------------------------------------------------------------------------
// Brotli  (lazy WASM initialisation)
// ---------------------------------------------------------------------------

let brotliDecompressFn: ((data: Uint8Array) => Uint8Array) | null = null;

export async function ensureBrotli(): Promise<void> {
  if (brotliDecompressFn) return;
  const mod = await import("brotli-wasm");
  const brotli = await mod.default;
  brotliDecompressFn = (data: Uint8Array) => brotli.decompress(data);
}

export function brotliDecompress(data: Uint8Array): Uint8Array {
  if (!brotliDecompressFn) {
    throw new Error("brotli-wasm is not initialised — call ensureBrotli() first");
  }
  return brotliDecompressFn(data);
}

export function isBrotliReady(): boolean {
  return brotliDecompressFn !== null;
}
