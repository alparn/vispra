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
  const clipboard = ctx.clipboardManager;
  if (clipboard) {
    clipboard.processClipboardToken(packet);
  }
}

export function handleSetClipboardEnabled(
  packet: SetClipboardEnabledPacket,
  ctx: HandlerContext,
): void {
  const clipboard = ctx.clipboardManager;
  if (clipboard) {
    clipboard.processSetClipboardEnabled(packet);
  }
}

export function handleClipboardRequest(
  packet: ClipboardRequestPacket,
  ctx: HandlerContext,
): void {
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
