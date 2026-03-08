/*
 * Author: Ali Parnan
 */

import { decompressBlock as lz4DecompressBlock } from "lz4js";

/**
 * Xpra draw-packet layout (indices into the array):
 *   [0] type, [1] wid, [2] x, [3] y, [4] width, [5] height,
 *   [6] coding, [7] data, [8] seq, [9] rowstride, [10] options
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrawPacket = [
  string,   // [0] type
  number,   // [1] wid
  number,   // [2] x
  number,   // [3] y
  number,   // [4] width
  number,   // [5] height
  string,   // [6] coding
  any,      // [7] data — Uint8Array | ArrayBuffer | ImageBitmap | VideoFrame | null
  number,   // [8] packet_sequence
  number,   // [9] rowstride
  Record<string, unknown>, // [10] options
];

/**
 * Decode an RGB draw-packet in-place: handles LZ4 decompression,
 * rgb24→rgb32 conversion and row-stride normalisation.
 * Returns the decoded pixel data as a `Uint8Array` (always RGBA, tightly packed).
 */
export function decode_rgb(packet: DrawPacket): Uint8Array {
  const width = packet[4];
  const height = packet[5];
  const coding = packet[6];
  const rowstride = packet[9];
  let data = packet[7];
  const options = (packet[10] ?? {}) as Record<string, number>;

  if (options["zlib"] > 0) {
    throw new Error("zlib compression is not supported");
  }
  if (options["lz4"] > 0) {
    const src = data as Uint8Array;
    const uncompLen =
      src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
    const inflated = new Uint8Array(uncompLen);
    lz4DecompressBlock(src, inflated, 4, src.length - 4, 0);
    data = inflated;
    delete options["lz4"];
  }

  if (coding === "rgb24") {
    packet[9] = width * 4;
    packet[6] = "rgb32";
    return rgb24_to_rgb32(
      data as Uint8Array,
      width,
      height,
      rowstride,
    );
  }

  // coding === rgb32
  if (rowstride === width * 4) {
    return new Uint8Array(data as ArrayBufferLike);
  }

  // re-stride so that each row is exactly width*4 bytes
  const uint = new Uint8Array(width * height * 4);
  let psrc = 0;
  let pdst = 0;
  for (let row = 0; row < height; row++) {
    psrc = row * rowstride;
    pdst = row * width * 4;
    for (let col = 0; col < width * 4; col++) {
      uint[pdst++] = (data as Uint8Array)[psrc++];
    }
  }
  return uint;
}

/**
 * Convert 24-bit RGB pixel data to 32-bit RGBA (alpha = 255).
 * Handles arbitrary source row-strides.
 */
export function rgb24_to_rgb32(
  data: Uint8Array,
  width: number,
  height: number,
  rowstride: number,
): Uint8Array {
  const uint = new Uint8Array(width * height * 4);
  let si = 0;
  let ti = 0;

  if (rowstride === width * 3) {
    const len = data.length;
    while (si < len) {
      uint[ti++] = data[si++];
      uint[ti++] = data[si++];
      uint[ti++] = data[si++];
      uint[ti++] = 255;
    }
  } else {
    for (let row = 0; row < height; row++) {
      si = row * rowstride;
      for (let col = 0; col < width; col++) {
        uint[ti++] = data[si++];
        uint[ti++] = data[si++];
        uint[ti++] = data[si++];
        uint[ti++] = 255;
      }
    }
  }
  return uint;
}
