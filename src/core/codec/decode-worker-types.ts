/*
 * Author: Ali Parnan
 *
 * Typed message protocol for communication between the main thread
 * (decode-worker host) and the decode web worker.
 *
 * Import these types from both sides to get full type-safety on
 * postMessage / onmessage without any runtime overhead.
 */

import type { DrawPacket } from "@/core/codec/rgb-helpers";

// ---------------------------------------------------------------------------
// Host → Worker (inbound) messages
// ---------------------------------------------------------------------------

export interface DecodeDrawCommand {
  readonly c: "decode";
  readonly packet: DrawPacket;
  readonly start: number;
}

export interface DecodeCheckCommand {
  readonly c: "check";
  readonly encodings: string[];
}

export interface DecodeEosCommand {
  readonly c: "eos";
  readonly wid: number;
}

export interface DecodeRemoveCommand {
  readonly c: "remove";
  readonly wid: number;
}

export interface DecodeCloseCommand {
  readonly c: "close";
}

export type DecodeWorkerInbound =
  | DecodeDrawCommand
  | DecodeCheckCommand
  | DecodeEosCommand
  | DecodeRemoveCommand
  | DecodeCloseCommand;

// ---------------------------------------------------------------------------
// Worker → Host (outbound) messages
// ---------------------------------------------------------------------------

export interface DecodeDrawResult {
  readonly c: "draw";
  readonly packet: DrawPacket;
  readonly start: number;
}

export interface DecodeErrorResult {
  readonly c: "error";
  readonly error: string;
  readonly packet: DrawPacket;
  readonly start: number;
}

export interface DecodeCheckSuccess {
  readonly c: "check-result";
  readonly result: true;
  readonly formats: string[];
}

export interface DecodeCheckFailure {
  readonly c: "check-result";
  readonly result: false;
  readonly errors: string[];
}

export interface DecodeWorkerReady {
  readonly c: "ready";
}

export type DecodeWorkerOutbound =
  | DecodeDrawResult
  | DecodeErrorResult
  | DecodeCheckSuccess
  | DecodeCheckFailure
  | DecodeWorkerReady;
