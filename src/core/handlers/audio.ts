/*
 * Author: Ali Parnan
 *
 * Sound data packet handler. Delegates to audio pipeline when available.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { s } from "@/core/utils/encoding";
import type { ServerPacket, SoundDataPacket } from "@/core/protocol/types";
import type { HandlerContext } from "./types";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleSoundData(
  packet: SoundDataPacket,
  ctx: HandlerContext,
): void {
  try {
    const codec = s(packet[1]);
    const buf = packet[2];
    const options = (packet[3] ?? {}) as Record<string, unknown>;
    const metadata = (packet[4] ?? {}) as Record<string, unknown>;

    if (ctx.processSoundData) {
      ctx.processSoundData(packet);
      return;
    }

    // Minimal fallback: delegate to context if available
    if (ctx.addSoundData && buf && buf.length > 0) {
      if (options["start-of-stream"]) {
        ctx.audioStartStream?.();
      }
      ctx.addSoundData(codec, buf, metadata);
      if (options["end-of-stream"]) {
        ctx.closeAudio?.();
      }
    }
  } catch (err) {
    ctx.error?.("sound data error", err);
    ctx.closeAudio?.();
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const audioHandlers: Partial<
  Record<string, (p: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.sound_data]:
    handleSoundData as (p: ServerPacket, ctx: HandlerContext) => void,
};
