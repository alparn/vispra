import { describe, it, expect } from "vitest";
import type {
  DecodeWorkerInbound,
  DecodeWorkerOutbound,
  DecodeDrawCommand,
  DecodeCheckCommand,
  DecodeEosCommand,
  DecodeRemoveCommand,
  DecodeCloseCommand,
  DecodeDrawResult,
  DecodeErrorResult,
  DecodeCheckSuccess,
  DecodeCheckFailure,
  DecodeWorkerReady,
} from "@/core/codec/decode-worker-types";
import type { DrawPacket } from "@/core/codec/rgb-helpers";

function makeDrawPacket(overrides: Partial<{
  wid: number;
  width: number;
  height: number;
  coding: string;
  data: Uint8Array;
  seq: number;
  rowstride: number;
  options: Record<string, unknown>;
}> = {}): DrawPacket {
  const w = overrides.width ?? 2;
  const h = overrides.height ?? 2;
  return [
    "draw",
    overrides.wid ?? 1,
    0,
    0,
    w,
    h,
    overrides.coding ?? "rgb32",
    overrides.data ?? new Uint8Array(w * h * 4).fill(128),
    overrides.seq ?? 1,
    overrides.rowstride ?? w * 4,
    overrides.options ?? {},
  ];
}

describe("decode-worker-types", () => {
  describe("inbound message types", () => {
    it("accepts a decode command", () => {
      const cmd: DecodeDrawCommand = {
        c: "decode",
        packet: makeDrawPacket(),
        start: performance.now(),
      };
      expect(cmd.c).toBe("decode");
      expect(cmd.packet[0]).toBe("draw");
    });

    it("accepts a check command", () => {
      const cmd: DecodeCheckCommand = {
        c: "check",
        encodings: ["png", "jpeg", "webp"],
      };
      expect(cmd.c).toBe("check");
      expect(cmd.encodings).toHaveLength(3);
    });

    it("accepts an eos command", () => {
      const cmd: DecodeEosCommand = { c: "eos", wid: 42 };
      expect(cmd.c).toBe("eos");
      expect(cmd.wid).toBe(42);
    });

    it("accepts a remove command", () => {
      const cmd: DecodeRemoveCommand = { c: "remove", wid: 7 };
      expect(cmd.c).toBe("remove");
    });

    it("accepts a close command", () => {
      const cmd: DecodeCloseCommand = { c: "close" };
      expect(cmd.c).toBe("close");
    });

    it("union type covers all commands", () => {
      const messages: DecodeWorkerInbound[] = [
        { c: "decode", packet: makeDrawPacket(), start: 0 },
        { c: "check", encodings: [] },
        { c: "eos", wid: 1 },
        { c: "remove", wid: 1 },
        { c: "close" },
      ];
      expect(messages).toHaveLength(5);
    });
  });

  describe("outbound message types", () => {
    it("accepts a draw result", () => {
      const msg: DecodeDrawResult = {
        c: "draw",
        packet: makeDrawPacket(),
        start: 0,
      };
      expect(msg.c).toBe("draw");
    });

    it("accepts an error result", () => {
      const msg: DecodeErrorResult = {
        c: "error",
        error: "something went wrong",
        packet: makeDrawPacket(),
        start: 0,
      };
      expect(msg.c).toBe("error");
      expect(msg.error).toContain("wrong");
    });

    it("accepts a successful check result", () => {
      const msg: DecodeCheckSuccess = {
        c: "check-result",
        result: true,
        formats: ["rgb24", "rgb32", "png", "jpeg"],
      };
      expect(msg.result).toBe(true);
      expect(msg.formats).toContain("png");
    });

    it("accepts a failed check result", () => {
      const msg: DecodeCheckFailure = {
        c: "check-result",
        result: false,
        errors: ["avif not supported"],
      };
      expect(msg.result).toBe(false);
      expect(msg.errors).toHaveLength(1);
    });

    it("accepts a ready message", () => {
      const msg: DecodeWorkerReady = { c: "ready" };
      expect(msg.c).toBe("ready");
    });

    it("union type covers all outbound messages", () => {
      const messages: DecodeWorkerOutbound[] = [
        { c: "draw", packet: makeDrawPacket(), start: 0 },
        { c: "error", error: "x", packet: makeDrawPacket(), start: 0 },
        { c: "check-result", result: true, formats: [] },
        { c: "check-result", result: false, errors: [] },
        { c: "ready" },
      ];
      expect(messages).toHaveLength(5);
    });
  });

  describe("transferable semantics", () => {
    it("draw packet data is an ArrayBuffer-backed Uint8Array", () => {
      const packet = makeDrawPacket();
      const data = packet[7] as Uint8Array;
      expect(data.buffer).toBeInstanceOf(ArrayBuffer);
    });

    it("ImageBitmap is a valid Transferable target in packet[7]", () => {
      const packet = makeDrawPacket();
      packet[6] = "bitmap:rgb32";
      packet[7] = null;
      expect(packet[6]).toBe("bitmap:rgb32");
    });
  });

  describe("draw command construction", () => {
    it("preserves packet sequence for ordering", () => {
      const cmd: DecodeDrawCommand = {
        c: "decode",
        packet: makeDrawPacket({ seq: 42 }),
        start: 100.5,
      };
      expect(cmd.packet[8]).toBe(42);
      expect(cmd.start).toBe(100.5);
    });

    it("passes scaled_size option through", () => {
      const cmd: DecodeDrawCommand = {
        c: "decode",
        packet: makeDrawPacket({
          options: { scaled_size: [100, 80] },
        }),
        start: 0,
      };
      const opts = cmd.packet[10] as Record<string, unknown>;
      expect(opts["scaled_size"]).toEqual([100, 80]);
    });

    it("handles various coding types", () => {
      const codings = [
        "rgb24",
        "rgb32",
        "png",
        "png/L",
        "png/P",
        "jpeg",
        "webp",
        "avif",
        "h264",
        "scroll",
      ];
      for (const coding of codings) {
        const cmd: DecodeDrawCommand = {
          c: "decode",
          packet: makeDrawPacket({ coding }),
          start: 0,
        };
        expect(cmd.packet[6]).toBe(coding);
      }
    });
  });
});
