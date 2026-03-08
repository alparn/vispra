/*
 * Author: Ali Parnan
 *
 * Typed message protocol for the offscreen decode worker.
 * The worker receives an OffscreenCanvas, decodes draw packets, and paints
 * directly onto the canvas (visible on the main thread).
 */

import type { DrawPacket } from "./rgb-helpers";

// ---------------------------------------------------------------------------
// Host → Worker (inbound) messages
// ---------------------------------------------------------------------------

export interface OffscreenCheckCommand {
  readonly c: "check";
  readonly encodings: string[];
}

export interface OffscreenEosCommand {
  readonly c: "eos";
  readonly wid: number;
}

export interface OffscreenRemoveCommand {
  readonly c: "remove";
  readonly wid: number;
}

export interface OffscreenDecodeCommand {
  readonly c: "decode";
  readonly packet: DrawPacket;
}

export interface OffscreenRedrawCommand {
  readonly c: "redraw";
  readonly wid: number;
}

export interface OffscreenCanvasCommand {
  readonly c: "canvas";
  readonly wid: number;
  readonly canvas: OffscreenCanvas;
  readonly debug?: boolean;
}

export interface OffscreenCanvasGeoCommand {
  readonly c: "canvas-geo";
  readonly wid: number;
  readonly w: number;
  readonly h: number;
}

export interface OffscreenCloseCommand {
  readonly c: "close";
}

export type OffscreenWorkerInbound =
  | OffscreenCheckCommand
  | OffscreenEosCommand
  | OffscreenRemoveCommand
  | OffscreenDecodeCommand
  | OffscreenRedrawCommand
  | OffscreenCanvasCommand
  | OffscreenCanvasGeoCommand
  | OffscreenCloseCommand;

// ---------------------------------------------------------------------------
// Worker → Host (outbound) messages
// ---------------------------------------------------------------------------

export interface OffscreenCheckResult {
  readonly result: true;
  readonly formats: string[];
}

export interface OffscreenDrawResult {
  readonly draw: DrawPacket;
  readonly start: number;
}

export interface OffscreenErrorResult {
  readonly error: string;
  readonly packet: DrawPacket;
}

export type OffscreenWorkerOutbound =
  | OffscreenCheckResult
  | OffscreenDrawResult
  | OffscreenErrorResult;
