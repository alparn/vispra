/*
 * Author: Ali Parnan
 *
 * Cursor, pointer_position, and bell packet handlers.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import type {
  BellPacket,
  CursorPacket,
  PointerPositionPacket,
  ServerPacket,
} from "@/core/protocol/types";
import type { HandlerContext } from "./types";

const BELL_SOUND = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUtvT18=";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleCursor(packet: CursorPacket, ctx: HandlerContext): void {
  if (packet.length < 9) {
    ctx.resetCursor?.();
    return;
  }

  const encoding = packet[1];
  if (encoding !== "png") {
    ctx.warn?.(`invalid cursor encoding: ${encoding}`);
    return;
  }

  const w = packet[4];
  const h = packet[5];
  const xhot = packet[6];
  const yhot = packet[7];
  const imgData = packet[9];
  if (!imgData) return;

  ctx.setCursorForAllWindows?.(encoding, w ?? 0, h ?? 0, xhot ?? 0, yhot ?? 0, imgData);
}

export function handlePointerPosition(
  packet: PointerPositionPacket,
  ctx: HandlerContext,
): void {
  const wid = packet[1];
  let x = packet[2];
  let y = packet[3];

  const win = ctx.getWindow?.(wid);
  if (packet.length >= 6 && win?.getInternalGeometry) {
    const pos = win.getInternalGeometry();
    x = pos.x + (packet[4] ?? 0);
    y = pos.y + (packet[5] ?? 0);
  }

  ctx.updateShadowPointer?.(wid, x, y, win);
}

export function handleBell(packet: BellPacket, ctx: HandlerContext): void {
  const percent = (packet[3] as number) ?? 100;
  const pitch = (packet[4] as number) ?? 440;
  const duration = (packet[5] as number) ?? 100;

  if (ctx.playBell) {
    ctx.playBell(percent, pitch, duration);
    return;
  }

  // Fallback: use Web Audio API or Audio element
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      const ac = new AudioContextClass();
      const oscillator = ac.createOscillator();
      const gainNode = ac.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ac.destination);
      gainNode.gain.setValueAtTime(percent / 100, ac.currentTime);
      oscillator.frequency.setValueAtTime(pitch, ac.currentTime);
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        ac.close();
      }, duration);
    } else {
      const snd = new Audio(BELL_SOUND);
      snd.volume = percent / 100;
      snd.play();
    }
  } catch {
    const snd = new Audio(BELL_SOUND);
    snd.volume = percent / 100;
    snd.play();
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const inputHandlers: Partial<
  Record<string, (p: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.cursor]: handleCursor as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.pointer_position]:
    handlePointerPosition as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.bell]: handleBell as (p: ServerPacket, ctx: HandlerContext) => void,
};
