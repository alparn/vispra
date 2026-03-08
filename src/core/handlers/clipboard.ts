/*
 * Author: Ali Parnan
 *
 * Clipboard packet handlers. Delegates to ClipboardManager when available.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import type {
  ClipboardRequestPacket,
  ClipboardTokenPacket,
  ServerPacket,
  SetClipboardEnabledPacket,
} from "@/core/protocol/types";
import type { HandlerContext } from "./types";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleClipboardToken(
  packet: ClipboardTokenPacket,
  ctx: HandlerContext,
): void {
  console.log("[clipboard-handler] clipboard-token received, selection=", packet[1], "hasManager=", !!ctx.clipboardManager);
  const clipboard = ctx.clipboardManager;
  if (clipboard) {
    clipboard.processClipboardToken(packet);
  }
}

export function handleSetClipboardEnabled(
  packet: SetClipboardEnabledPacket,
  ctx: HandlerContext,
): void {
  console.log("[clipboard-handler] set-clipboard-enabled received, enabled=", packet[1], "reason=", packet[2]);
  const clipboard = ctx.clipboardManager;
  if (clipboard) {
    clipboard.processSetClipboardEnabled(packet);
  }
}

export function handleClipboardRequest(
  packet: ClipboardRequestPacket,
  ctx: HandlerContext,
): void {
  console.log("[clipboard-handler] clipboard-request received, requestId=", packet[1], "selection=", packet[2], "hasManager=", !!ctx.clipboardManager);
  const clipboard = ctx.clipboardManager;
  if (clipboard) {
    clipboard.processClipboardRequest(packet);
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const clipboardHandlers: Partial<
  Record<string, (p: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.clipboard_token]:
    handleClipboardToken as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.set_clipboard_enabled]:
    handleSetClipboardEnabled as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.clipboard_request]:
    handleClipboardRequest as (p: ServerPacket, ctx: HandlerContext) => void,
};
