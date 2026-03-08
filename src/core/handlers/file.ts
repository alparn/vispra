/*
 * Author: Ali Parnan
 *
 * File transfer packet handlers: send_file, send_file_chunk, ack_file_chunk.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { s } from "@/core/utils/encoding";
import type {
  AckFileChunkPacket,
  SendFileChunkPacket,
  SendFilePacket,
  ServerPacket,
} from "@/core/protocol/types";
import type { HandlerContext } from "./types";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleSendFile(
  packet: SendFilePacket,
  ctx: HandlerContext,
): void {
  const basefilename = s(packet[1]);
  const mimetype = s(packet[2]);
  const printit = packet[3] as boolean;
  const filesize = packet[5] as number;
  const data = packet[6];
  const options = (packet[7] ?? {}) as Record<string, unknown>;
  const sendId = s(packet[8]);

  if (ctx.processSendFile) {
    ctx.processSendFile(packet);
    return;
  }

  // Minimal handling: if we got the whole file in one packet
  if (data && typeof (data as Uint8Array).length === "number") {
    const dataLen = (data as Uint8Array).length;
    if (dataLen === filesize) {
      ctx.onFileReceived?.(basefilename, mimetype, printit, data as Uint8Array, options);
      return;
    }
  }

  // Chunked transfer: delegate to file transfer manager
  if (sendId) {
    const chunkId = s(options["file-chunk-id"] ?? "");
    if (chunkId && ctx.startFileChunkReceive) {
      ctx.startFileChunkReceive(chunkId, basefilename, mimetype, printit, filesize, options, sendId);
    }
  }
}

export function handleSendFileChunk(
  packet: SendFileChunkPacket,
  ctx: HandlerContext,
): void {
  const chunkId = packet[1];
  const chunk = packet[2];
  const fileData = packet[3];
  const hasMore = packet[4];

  if (ctx.processFileChunk) {
    ctx.processFileChunk(packet);
    return;
  }

  ctx.onFileChunkReceived?.(chunkId, chunk, fileData, hasMore);
}

export function handleAckFileChunk(
  packet: AckFileChunkPacket,
  ctx: HandlerContext,
): void {
  const chunkId = packet[1];
  const state = packet[2];
  const errorMessage = packet[3];
  const chunk = packet[4];

  if (ctx.processAckFileChunk) {
    ctx.processAckFileChunk(packet);
    return;
  }

  ctx.onAckFileChunk?.(chunkId, state, errorMessage, chunk);
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const fileHandlers: Partial<
  Record<string, (p: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.send_file]:
    handleSendFile as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.send_file_chunk]:
    handleSendFileChunk as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.ack_file_chunk]:
    handleAckFileChunk as (p: ServerPacket, ctx: HandlerContext) => void,
};
