/*
 * Author: Ali Parnan
 *
 * Lightweight bridge so UI components can send packets to the Xpra server
 * without a direct reference to the XpraClient instance.
 */

import type { ClientPacket, FocusPacket, CloseWindowPacket } from "@/core/protocol/types";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import { focusedWid, setFocusedWindow } from "@/store/windows";
import type { MouseWindow, MouseEventLike } from "@/core/input/mouse";

type PacketSender = (packet: ClientPacket) => void;
type RendererResizer = (wid: number, w: number, h: number) => void;
type MouseEventForwarder = (
  type: "down" | "up" | "move" | "wheel",
  e: MouseEvent | WheelEvent,
  win: MouseWindow,
) => void;
type DisplayConfigurator = () => void;

let sender: PacketSender | null = null;
let rendererResizer: RendererResizer | null = null;
let mouseForwarder: MouseEventForwarder | null = null;
let displayConfigurator: DisplayConfigurator | null = null;

export function registerPacketSender(fn: PacketSender): void {
  sender = fn;
}

export function unregisterPacketSender(): void {
  sender = null;
}

export function sendPacket(packet: ClientPacket): void {
  sender?.(packet);
}

export function registerRendererResizer(fn: RendererResizer): void {
  rendererResizer = fn;
}

export function unregisterRendererResizer(): void {
  rendererResizer = null;
}

/** Tell the WindowRenderer to update its internal canvas geometry. */
export function resizeRenderer(wid: number, w: number, h: number): void {
  rendererResizer?.(wid, w, h);
}

/**
 * Set focus on a window: updates the store AND notifies the server.
 * Skips if the window is already focused (avoids redundant packets).
 */
export function focusWindow(wid: number): void {
  if (focusedWid() === wid) return;
  setFocusedWindow(wid);
  sender?.([PACKET_TYPES.focus, wid, []] as FocusPacket);
}

/**
 * Ask the server to close a window. The server responds with lost-window
 * once the application actually closes.
 */
export function sendCloseWindow(wid: number): void {
  sender?.([PACKET_TYPES.close_window, wid] as CloseWindowPacket);
}

// ---------------------------------------------------------------------------
// Display configuration (delegates to XpraClient.sendConfigureDisplay)
// ---------------------------------------------------------------------------

export function registerDisplayConfigurator(fn: DisplayConfigurator): void {
  displayConfigurator = fn;
}

export function unregisterDisplayConfigurator(): void {
  displayConfigurator = null;
}

export function triggerConfigureDisplay(): void {
  displayConfigurator?.();
}

// ---------------------------------------------------------------------------
// Mouse event forwarding
// ---------------------------------------------------------------------------

export function registerMouseForwarder(fn: MouseEventForwarder): void {
  mouseForwarder = fn;
}

export function unregisterMouseForwarder(): void {
  mouseForwarder = null;
}

export function forwardMouseEvent(
  type: "down" | "up" | "move" | "wheel",
  e: MouseEvent | WheelEvent,
  win: MouseWindow,
): void {
  mouseForwarder?.(type, e, win);
}

export type { MouseWindow, MouseEventLike };
