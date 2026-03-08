import { describe, it, expect } from "vitest";
import { decode_rgb, rgb24_to_rgb32, type DrawPacket } from "../rgb-helpers";

function makePacket(
  overrides: Partial<{
    width: number;
    height: number;
    coding: string;
    data: Uint8Array;
    rowstride: number;
    options: Record<string, unknown>;
  }> = {},
): DrawPacket {
  const w = overrides.width ?? 2;
  const h = overrides.height ?? 2;
  const coding = overrides.coding ?? "rgb32";
  const rowstride = overrides.rowstride ?? w * 4;
  const data = overrides.data ?? new Uint8Array(w * h * 4).fill(128);
  const options = overrides.options ?? {};
  return ["draw", 1, 0, 0, w, h, coding, data, 1, rowstride, options];
}

describe("rgb24_to_rgb32", () => {
  it("converts tightly-packed rgb24 to rgb32 with alpha=255", () => {
    const rgb24 = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const result = rgb24_to_rgb32(rgb24, 2, 1, 6);
    expect(result).toEqual(
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    );
  });

  it("handles non-tight rowstride", () => {
    // 1px wide, 2 rows, rowstride=4 (1 byte padding per row)
    const rgb24 = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 0]);
    const result = rgb24_to_rgb32(rgb24, 1, 2, 4);
    expect(result).toEqual(
      new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]),
    );
  });
});

describe("decode_rgb", () => {
  it("returns Uint8Array for tightly-packed rgb32", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const packet = makePacket({ width: 2, height: 1, data, rowstride: 8 });
    const result = decode_rgb(packet);
    expect(result).toEqual(data);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("re-strides rgb32 when rowstride != width*4", () => {
    // 1px wide, 2 rows, rowstride=8 (4 bytes padding per row)
    const data = new Uint8Array([10, 20, 30, 40, 0, 0, 0, 0, 50, 60, 70, 80, 0, 0, 0, 0]);
    const packet = makePacket({
      width: 1,
      height: 2,
      data,
      rowstride: 8,
    });
    const result = decode_rgb(packet);
    expect(result).toEqual(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]));
  });

  it("converts rgb24 to rgb32", () => {
    const rgb24 = new Uint8Array([255, 128, 0, 0, 128, 255]);
    const packet = makePacket({
      width: 2,
      height: 1,
      coding: "rgb24",
      data: rgb24,
      rowstride: 6,
    });
    const result = decode_rgb(packet);
    expect(packet[6]).toBe("rgb32");
    expect(packet[9]).toBe(8);
    expect(result).toEqual(
      new Uint8Array([255, 128, 0, 255, 0, 128, 255, 255]),
    );
  });

  it("throws on zlib compression", () => {
    const packet = makePacket({ options: { zlib: 1 } });
    expect(() => decode_rgb(packet)).toThrow("zlib");
  });
});
