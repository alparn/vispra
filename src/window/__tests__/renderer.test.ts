/*
 * Author: Ali Parnan
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WindowRenderer } from "../renderer";
import type { DrawPacket } from "@/core/codec/rgb-helpers";

function createMockContext(): CanvasRenderingContext2D {
  return {
    imageSmoothingEnabled: false,
    strokeStyle: "",
    lineWidth: 0,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    putImageData: vi.fn(),
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8Array(w * h * 4),
    }),
  } as unknown as CanvasRenderingContext2D;
}

let mockCtx: CanvasRenderingContext2D;

beforeEach(() => {
  mockCtx = createMockContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockCtx);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  return canvas;
}

function makeDrawPacket(overrides: Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
  coding: string;
  data: Uint8Array | ImageBitmap;
  options: Record<string, unknown>;
}> = {}): DrawPacket {
  const w = overrides.width ?? 10;
  const h = overrides.height ?? 10;
  const data = overrides.data ?? new Uint8Array(w * h * 4).fill(128);
  return [
    "draw",
    1,
    overrides.x ?? 0,
    overrides.y ?? 0,
    w,
    h,
    overrides.coding ?? "rgb32",
    data,
    1,
    w * 4,
    overrides.options ?? {},
  ];
}

describe("WindowRenderer", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
  });

  it("instantiates with canvas and dimensions", () => {
    const renderer = new WindowRenderer({
      canvas,
      width: 100,
      height: 80,
    });
    expect(renderer.width).toBe(100);
    expect(renderer.height).toBe(80);
  });

  it("swap_buffers does not throw", () => {
    const renderer = new WindowRenderer({
      canvas,
      width: 50,
      height: 50,
    });
    expect(() => renderer.swap_buffers()).not.toThrow();
  });

  it("draw does not throw", () => {
    const renderer = new WindowRenderer({
      canvas,
      width: 50,
      height: 50,
    });
    expect(() => renderer.draw()).not.toThrow();
  });

  it("paint with void coding invokes decodeCallback", () => {
    const renderer = new WindowRenderer({
      canvas,
      width: 50,
      height: 50,
      useDecodeWorker: true,
    });
    const packet = makeDrawPacket({ coding: "void", data: new Uint8Array(0) });
    const cb = vi.fn();
    renderer.paint(packet, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith();
  });

  it("paint with rgb32 invokes decodeCallback after sync paint", () => {
    const renderer = new WindowRenderer({
      canvas,
      width: 50,
      height: 50,
      useDecodeWorker: true,
    });
    const packet = makeDrawPacket({
      coding: "rgb32",
      width: 4,
      height: 4,
      data: new Uint8Array(4 * 4 * 4).fill(200),
    });
    const cb = vi.fn();
    renderer.paint(packet, cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("updateCanvasGeometry updates dimensions", () => {
    const renderer = new WindowRenderer({
      canvas,
      width: 50,
      height: 50,
    });
    renderer.updateCanvasGeometry(120, 90);
    expect(renderer.width).toBe(120);
    expect(renderer.height).toBe(90);
  });
});
