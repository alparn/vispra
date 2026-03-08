/*
 * Author: Ali Parnan
 *
 * Combined packet handlers — Phase 7a.
 * Merges all 42 packet handlers from 8 modules into a single map.
 */

import type { ServerPacket } from "@/core/protocol/types";
import type { HandlerContext } from "./types";
import { connectionHandlers } from "./connection";
import { windowHandlers } from "./window";
import { drawHandlers } from "./draw";
import { inputHandlers } from "./input";
import { clipboardHandlers } from "./clipboard";
import { audioHandlers } from "./audio";
import { fileHandlers } from "./file";
import { systemHandlers } from "./system";

// ---------------------------------------------------------------------------
// Merged handler map
// ---------------------------------------------------------------------------

export type PacketHandler = (packet: ServerPacket, ctx: HandlerContext) => void;

export const packetHandlers: Partial<Record<string, PacketHandler>> = {
  ...connectionHandlers,
  ...windowHandlers,
  ...drawHandlers,
  ...inputHandlers,
  ...clipboardHandlers,
  ...audioHandlers,
  ...fileHandlers,
  ...systemHandlers,
};

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { connectionHandlers } from "./connection";
export { windowHandlers } from "./window";
export { drawHandlers } from "./draw";
export { inputHandlers } from "./input";
export { clipboardHandlers } from "./clipboard";
export { audioHandlers } from "./audio";
export { fileHandlers } from "./file";
export { systemHandlers } from "./system";
export type { HandlerContext, WindowLike } from "./types";
