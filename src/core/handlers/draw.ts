/*
 * Author: Ali Parnan
 *
 * Draw and EOS packet handlers.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { s } from "@/core/utils/encoding";
import type {
  DrawPacket,
  EosPacket,
  ServerPacket,
} from "@/core/protocol/types";
import type { HandlerContext } from "./types";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleDraw(packet: DrawPacket, ctx: HandlerContext): void {
  const coding = s(packet[6]);
  const imgData = packet[7];
  const rawBuffers: ArrayBuffer[] = [];
  const now = performance.now();

  if (coding !== "scroll" && imgData) {
    const buf = imgData as ArrayBuffer | Uint8Array;
    const ab = buf instanceof Uint8Array ? buf.buffer : (buf as ArrayBuffer);
    if (ab instanceof ArrayBuffer) rawBuffers.push(ab);
  }

  if (ctx.decodeWorker) {
    ctx.decodeWorker.postMessage(
      { c: "decode", packet, start: now },
      rawBuffers,
    );
  } else if (ctx.processDraw) {
    ctx.processDraw(packet, now);
  }
}

export function handleEos(packet: EosPacket, ctx: HandlerContext): void {
  const wid = packet[1];

  if (ctx.processDraw) {
    ctx.processDraw(packet as unknown as DrawPacket, 0);
  }
  if (ctx.decodeWorker) {
    ctx.decodeWorker.postMessage({ c: "eos", wid });
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const drawHandlers: Partial<
  Record<string, (p: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.draw]: handleDraw as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.eos]: handleEos as (p: ServerPacket, ctx: HandlerContext) => void,
};
