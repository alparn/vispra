/*
 * Author: Ali Parnan
 *
 * Connection-related packet handlers: open, close, error, disconnect,
 * hello, challenge, startup_complete.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { s } from "@/core/utils/encoding";
import type {
  ChallengePacket,
  ClosePacket,
  DisconnectPacket,
  ErrorPacket,
  HelloPacket,
  OpenPacket,
  ServerPacket,
  StartupCompletePacket,
} from "@/core/protocol/types";
import type { Capabilities } from "@/core/protocol/types";
import type { HandlerContext } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDisconnectReason(packet: ClosePacket | ErrorPacket | DisconnectPacket): string {
  const msg = packet[1] ?? "";
  if (typeof msg !== "string") return String(msg);
  let reason = msg;
  let idx = 2;
  while (packet.length > idx && packet[idx]) {
    reason += `\n${packet[idx]}`;
    idx++;
  }
  return reason;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleOpen(_packet: OpenPacket, ctx: HandlerContext): void {
  ctx.connectionStore.setProgress({ state: "WebSocket connection established", details: "", progress: 60 });
  ctx.onConnectionProgress?.("WebSocket connection established", "", 60);
  ctx.onOpen?.();
}

export function handleClose(packet: ClosePacket, ctx: HandlerContext): void {
  const reason = getDisconnectReason(packet);
  ctx.log?.("websocket closed:", packet[1], "reason:", reason);

  if (ctx.connectionStore.reconnectInProgress?.()) return;

  ctx.onClose?.(reason);
}

export function handleError(packet: ErrorPacket, ctx: HandlerContext): void {
  const code = Number(packet[2]);
  const reason = getDisconnectReason(packet);
  ctx.log?.("websocket error:", packet[1], "code:", code, "reason:", reason);

  if (ctx.connectionStore.reconnectInProgress?.()) return;

  ctx.connectionStore.setError(reason);
  ctx.onError?.(reason, code);
}

export function handleDisconnect(packet: DisconnectPacket, ctx: HandlerContext): void {
  const reason = getDisconnectReason(packet);
  ctx.debug?.("main", "disconnect reason:", packet[1]);

  if (ctx.connectionStore.reconnectInProgress?.()) return;

  ctx.connectionStore.setDisconnected(reason);
  ctx.onDisconnect?.(reason);
}

export function handleHello(packet: HelloPacket, ctx: HandlerContext): void {
  const hello = packet[1] as Capabilities;
  ctx.log?.("received hello capabilities");

  if (!hello["rencodeplus"]) {
    throw new Error("no common packet encoders, 'rencodeplus' is required by this client");
  }

  const version = s(hello["version"]);
  try {
    const vparts = version.split(".");
    const vno = vparts.map((x) => parseInt(x, 10));
    if (vno[0] <= 0 && vno[1] < 10) {
      ctx.onDisconnect?.(`unsupported version: ${version}`);
      return;
    }
  } catch {
    ctx.onDisconnect?.(`error parsing version number '${version}'`);
    return;
  }

  ctx.onHello?.(hello);
}

export function handleChallenge(packet: ChallengePacket, ctx: HandlerContext): void {
  ctx.onChallenge?.(packet);
}

export function handleStartupComplete(_packet: StartupCompletePacket, ctx: HandlerContext): void {
  ctx.log?.("startup complete");
  ctx.onConnectionEstablished?.();
  ctx.onStartupComplete?.();
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const connectionHandlers: Partial<Record<string, (p: ServerPacket, ctx: HandlerContext) => void>> = {
  [PACKET_TYPES.open]: handleOpen as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.close]: handleClose as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.error]: handleError as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.disconnect]: handleDisconnect as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.hello]: handleHello as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.challenge]: handleChallenge as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.startup_complete]: handleStartupComplete as (p: ServerPacket, ctx: HandlerContext) => void,
};
