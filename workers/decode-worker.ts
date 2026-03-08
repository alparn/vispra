/*
 * Author: Ali Parnan
 *
 * Web Worker that decodes draw packets off the main thread.
 * Converts raw image data (RGB, PNG, JPEG, WebP, AVIF) into
 * ImageBitmaps using createImageBitmap, then posts them back
 * as Transferable objects for zero-copy rendering.
 *
 * Maintains per-window packet ordering so that asynchronous
 * bitmap creation does not reorder frames.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { decode_rgb } from "@/core/codec/rgb-helpers";
import type { DrawPacket as RgbDrawPacket } from "@/core/codec/rgb-helpers";
import type {
  DecodeWorkerInbound,
  DecodeWorkerOutbound,
  DecodeDrawCommand,
} from "@/core/codec/decode-worker-types";

// ---------------------------------------------------------------------------
// Packet ordering – hold queue per window
// ---------------------------------------------------------------------------

type HeldEntry = [packet: RgbDrawPacket, transferables: Transferable[]];

const onHold = new Map<number, Map<number, HeldEntry[]>>();

let zeroCopy = true;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function doSendBack(
  packet: RgbDrawPacket,
  transferables: Transferable[],
  start: number,
): void {
  const msg: DecodeWorkerOutbound = {
    c: "draw",
    packet,
    start,
  };
  self.postMessage(msg, transferables);
}

function sendError(
  message: string,
  packet: RgbDrawPacket,
  start: number,
): void {
  const msg: DecodeWorkerOutbound = {
    c: "error",
    error: message,
    packet,
    start,
  };
  self.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Decode a single draw packet
// ---------------------------------------------------------------------------

function decodeDrawPacket(cmd: DecodeDrawCommand): void {
  const packet = cmd.packet as RgbDrawPacket;
  const start = cmd.start;

  const wid = packet[1];
  const width = packet[4];
  const height = packet[5];
  const coding = packet[6];
  const packetSequence = packet[8];

  function sendBack(transferables: Transferable[]): void {
    const widHold = onHold.get(wid);
    if (widHold) {
      let seqHolding = 0;
      for (const seq of widHold.keys()) {
        if (seq > seqHolding && seq < packetSequence) {
          seqHolding = seq;
        }
      }
      if (seqHolding) {
        const held = widHold.get(seqHolding);
        if (held) {
          held.push([packet, transferables]);
          return;
        }
      }
    }
    doSendBack(packet, transferables, start);
  }

  function hold(): Map<number, HeldEntry[]> {
    let widHold = onHold.get(wid);
    if (!widHold) {
      widHold = new Map();
      onHold.set(wid, widHold);
    }
    widHold.set(packetSequence, []);
    return widHold;
  }

  function release(): void {
    const widHold = onHold.get(wid);
    if (!widHold) return;

    const held = widHold.get(packetSequence);
    if (!held) return;

    for (const [heldPacket, heldTransferables] of held) {
      doSendBack(heldPacket, heldTransferables, start);
    }

    widHold.delete(packetSequence);
    if (widHold.size === 0) {
      onHold.delete(wid);
    }
  }

  function sendRgb32Back(
    data: Uint8Array,
    actualWidth: number,
    actualHeight: number,
    bitmapOptions: ImageBitmapOptions,
  ): void {
    const img = new ImageData(
      new Uint8ClampedArray(data.buffer as ArrayBuffer),
      actualWidth,
      actualHeight,
    );
    hold();
    createImageBitmap(img, 0, 0, actualWidth, actualHeight, bitmapOptions).then(
      (bitmap) => {
        packet[6] = `bitmap:rgb32`;
        packet[7] = bitmap;
        sendBack([bitmap]);
        release();
      },
      (error) => {
        sendError(
          `failed to create ${actualWidth}x${actualHeight} rgb32 bitmap: ${error}`,
          packet,
          start,
        );
        release();
      },
    );
  }

  const options: Record<string, unknown> =
    packet.length > 10 ? (packet[10] as Record<string, unknown>) : {};

  const bitmapOptions: ImageBitmapOptions = {
    premultiplyAlpha: "none",
  };

  if (options["scaled_size"]) {
    bitmapOptions.resizeWidth = width;
    bitmapOptions.resizeHeight = height;
    bitmapOptions.resizeQuality = "medium";
  }

  try {
    if (coding === "rgb24" || coding === "rgb32") {
      const data = decode_rgb(packet);
      sendRgb32Back(data, width, height, bitmapOptions);
    } else if (
      coding.startsWith("png") ||
      coding === "jpeg" ||
      coding === "webp" ||
      coding === "avif"
    ) {
      const imgData = packet[7] as Uint8Array | undefined;
      if (!imgData?.buffer) {
        sendError(`missing pixel data buffer: ${typeof imgData}`, packet, start);
        return;
      }

      const buffer = zeroCopy ? imgData.buffer : imgData;
      const paintCoding = coding.split("/")[0];
      const blob = new Blob([buffer as BlobPart], {
        type: `image/${paintCoding}`,
      });

      hold();
      createImageBitmap(blob, bitmapOptions).then(
        (bitmap) => {
          packet[6] = `bitmap:${coding}`;
          packet[7] = bitmap;
          sendBack([bitmap]);
          release();
        },
        (error) => {
          console.warn(
            `decode worker failed to create ${coding} bitmap: ${error}`,
          );
          sendBack([]);
          release();
          if (zeroCopy) {
            console.warn("turning off zerocopy");
            zeroCopy = false;
          }
        },
      );
    } else {
      sendBack([]);
    }
  } catch (error) {
    sendError(
      `error processing ${coding} packet ${packetSequence}: ${error}`,
      packet,
      start,
    );
  }
}

// ---------------------------------------------------------------------------
// Encoding capability check
// ---------------------------------------------------------------------------

const IMAGE_CHECK_DATA: Record<string, number[]> = {
  png: [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68,
    65, 84, 120, 218, 99, 252, 207, 192, 80, 15, 0, 4, 133, 1, 128, 132,
    169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ],
  webp: [
    82, 73, 70, 70, 58, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 46, 0, 0,
    0, 178, 2, 0, 157, 1, 42, 2, 0, 2, 0, 46, 105, 52, 154, 77, 34, 34,
    34, 34, 34, 0, 104, 75, 40, 0, 5, 206, 150, 90, 0, 0, 254, 247, 159,
    127, 253, 15, 63, 198, 192, 255, 242, 240, 96, 0, 0,
  ],
  jpeg: [
    255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 96, 0, 96,
    0, 0, 255, 219, 0, 67, 0, 8, 6, 6, 7, 6, 5, 8, 7, 7, 7, 9, 9, 8, 10,
    12, 20, 13, 12, 11, 11, 12, 25, 18, 19, 15, 20, 29, 26, 31, 30, 29,
    26, 28, 28, 32, 36, 46, 39, 32, 34, 44, 35, 28, 28, 40, 55, 41, 44,
    48, 49, 52, 52, 52, 31, 39, 57, 61, 56, 50, 60, 46, 51, 52, 50, 255,
    219, 0, 67, 1, 9, 9, 9, 12, 11, 12, 24, 13, 13, 24, 50, 33, 28, 33,
    50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50,
    50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50,
    50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50,
    255, 192, 0, 17, 8, 0, 1, 0, 1, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1, 255,
    196, 0, 31, 0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 255, 196, 0, 181, 16, 0, 2, 1, 3, 3,
    2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125, 1, 2, 3, 0, 4, 17, 5, 18, 33, 49,
    65, 6, 19, 81, 97, 7, 34, 113, 20, 50, 129, 145, 161, 8, 35, 66, 177,
    193, 21, 82, 209, 240, 36, 51, 98, 114, 130, 9, 10, 22, 23, 24, 25, 26,
    37, 38, 39, 40, 41, 42, 52, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71,
    72, 73, 74, 83, 84, 85, 86, 87, 88, 89, 90, 99, 100, 101, 102, 103,
    104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122, 131, 132, 133,
    134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153, 154,
    162, 163, 164, 165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182,
    183, 184, 185, 186, 194, 195, 196, 197, 198, 199, 200, 201, 202, 210,
    211, 212, 213, 214, 215, 216, 217, 218, 225, 226, 227, 228, 229, 230,
    231, 232, 233, 234, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250,
    255, 196, 0, 31, 1, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 255, 196, 0, 181, 17, 0, 2, 1,
    2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119, 0, 1, 2, 3, 17, 4, 5, 33,
    49, 6, 18, 65, 81, 7, 97, 113, 19, 34, 50, 129, 8, 20, 66, 145, 161,
    177, 193, 9, 35, 51, 82, 240, 21, 98, 114, 209, 10, 22, 36, 52, 225,
    37, 241, 23, 24, 25, 26, 38, 39, 40, 41, 42, 53, 54, 55, 56, 57, 58,
    67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86, 87, 88, 89, 90, 99,
    100, 101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121,
    122, 130, 131, 132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149,
    150, 151, 152, 153, 154, 162, 163, 164, 165, 166, 167, 168, 169, 170,
    178, 179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196, 197, 198,
    199, 200, 201, 202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 226,
    227, 228, 229, 230, 231, 232, 233, 234, 242, 243, 244, 245, 246, 247,
    248, 249, 250, 255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 247,
    250, 40, 162, 128, 63, 255, 217,
  ],
};

function checkImageDecode(
  format: string,
  imageBytes: number[],
  onSuccess: (fmt: string) => void,
  onFailure: (fmt: string, msg: string) => void,
): void {
  try {
    const timer = setTimeout(() => {
      onFailure(format, `timeout, no ${format} picture decoded`);
    }, 2000);

    const data = new Uint8Array(imageBytes);
    const blob = new Blob([data], { type: `image/${format}` });

    createImageBitmap(blob, { premultiplyAlpha: "none" }).then(
      () => {
        clearTimeout(timer);
        onSuccess(format);
      },
      (error) => {
        clearTimeout(timer);
        onFailure(format, `${error}`);
      },
    );
  } catch (error) {
    onFailure(format, `${error}`);
  }
}

function handleCheck(encodings: string[]): void {
  const remaining = new Set(Object.keys(IMAGE_CHECK_DATA));
  const formats: string[] = ["rgb24", "rgb32"];
  const errors: string[] = [];

  const done = (format: string): void => {
    remaining.delete(format);
    if (remaining.size > 0) return;

    const msg: DecodeWorkerOutbound =
      errors.length === 0
        ? { c: "check-result", result: true, formats }
        : { c: "check-result", result: false, errors };
    self.postMessage(msg);
  };

  const success = (format: string): void => {
    if (encodings.includes(format)) {
      formats.push(format);
    }
    done(format);
  };

  const failure = (format: string, message: string): void => {
    if (encodings.includes(format)) {
      errors.push(message);
      console.warn(`decode worker error on '${format}': ${message}`);
    }
    done(format);
  };

  for (const format of remaining) {
    checkImageDecode(format, IMAGE_CHECK_DATA[format], success, failure);
  }
}

// ---------------------------------------------------------------------------
// EOS / remove – flush held packets for a window
// ---------------------------------------------------------------------------

function handleEos(wid: number): void {
  onHold.delete(wid);
}

// ---------------------------------------------------------------------------
// Message handler (host → worker)
// ---------------------------------------------------------------------------

self.addEventListener("message", (e: MessageEvent<DecodeWorkerInbound>) => {
  const data = e.data;
  switch (data.c) {
    case "decode":
      decodeDrawPacket(data);
      break;
    case "check":
      handleCheck(data.encodings);
      break;
    case "eos":
      handleEos(data.wid);
      break;
    case "remove":
      handleEos(data.wid);
      onHold.delete(data.wid);
      break;
    case "close":
      onHold.clear();
      break;
    default: {
      const _: never = data;
      console.error("decode worker got unknown message:", _);
    }
  }
});

self.postMessage({ c: "ready" } satisfies DecodeWorkerOutbound);

export {};
