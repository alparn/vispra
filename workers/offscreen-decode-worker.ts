/*
 * Author: Ali Parnan
 *
 * Web Worker for offscreen decoding and painting.
 * Receives an OffscreenCanvas via transferControlToOffscreen(), decodes
 * draw packets (images + video), and paints directly onto the canvas.
 * The canvas is displayed on the main thread.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { XpraImageDecoder } from "@/core/codec/image-decoder";
import {
  XpraVideoDecoder,
  hasNativeVideoDecoder,
} from "@/core/codec/video-decoder";
import { DEFAULT_BOX_COLORS } from "@/core/constants/box-colors";
import type { DrawPacket } from "@/core/codec/rgb-helpers";
import type {
  OffscreenWorkerInbound,
  OffscreenWorkerOutbound,
} from "@/core/codec/offscreen-decode-worker-types";

// ---------------------------------------------------------------------------
// Supported encodings
// ---------------------------------------------------------------------------

const IMAGE_CODING = [
  "rgb",
  "rgb32",
  "rgb24",
  "jpeg",
  "png",
  "png/P",
  "png/L",
  "webp",
  "avif",
];

const VIDEO_CODING: string[] = hasNativeVideoDecoder()
  ? ["h264", "vp8"]
  : [];

const ALL_ENCODINGS = new Set([
  "void",
  "scroll",
  "eos",
  "throttle",
  ...IMAGE_CODING,
  ...VIDEO_CODING,
]);

// ---------------------------------------------------------------------------
// WindowDecoder – decodes and paints per-window onto OffscreenCanvas
// ---------------------------------------------------------------------------

type ScrollData = [sx: number, sy: number, sw: number, sh: number, xdelta: number, ydelta: number];

class WindowDecoder {
  private readonly wid: number;
  private canvas: OffscreenCanvas | null;
  private readonly ctx: OffscreenCanvasRenderingContext2D | null;
  private readonly debug: boolean;
  private readonly imageDecoder: XpraImageDecoder;
  private readonly videoDecoder: XpraVideoDecoder | null;
  private decodeQueue: DrawPacket[] = [];
  private decodeQueueDraining = false;
  closed = false;

  constructor(wid: number, canvas: OffscreenCanvas, debug: boolean) {
    this.wid = wid;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.debug = debug;
    this.imageDecoder = new XpraImageDecoder();
    this.videoDecoder = hasNativeVideoDecoder() ? new XpraVideoDecoder() : null;
  }

  private decodeError(packet: DrawPacket, error: string): void {
    const coding = packet[6];
    const packetSequence = packet[8];
    const message = `failed to decode '${coding}' draw packet sequence ${packetSequence}: ${error}`;
    console.error(message);
    packet[7] = null;
    this.sendDecodeError(packet, message);
  }

  private sendDecodeError(packet: DrawPacket, message: string): void {
    const msg: OffscreenWorkerOutbound = { error: message, packet };
    self.postMessage(msg);
  }

  queueDrawPacket(packet: DrawPacket): void {
    if (this.closed) return;
    this.decodeQueue.push(packet);
    if (!this.decodeQueueDraining) {
      this.processDecodeQueue();
    }
  }

  private processDecodeQueue(): void {
    this.decodeQueueDraining = true;
    const packet = this.decodeQueue.shift();
    if (!packet) {
      this.decodeQueueDraining = false;
      return;
    }
    this.processPacket(packet).then(
      () => {
        if (this.decodeQueue.length > 0) {
          this.processDecodeQueue();
        } else {
          this.decodeQueueDraining = false;
        }
      },
      (error) => {
        this.sendDecodeError(packet, String(error));
        this.decodeQueueDraining = false;
      },
    );
  }

  private async processPacket(packet: DrawPacket): Promise<void> {
    let coding = packet[6];
    const start = performance.now();

    if (coding === "eos" && this.videoDecoder) {
      this.videoDecoder.close();
      return;
    }

    if (coding === "scroll" || coding === "void") {
      this.postDrawAck(packet, start);
      if (coding === "scroll") {
        const image = packet[7] as ScrollData[] | undefined;
        if (image) {
          const [x, y, w, h] = [packet[2], packet[3], packet[4], packet[5]];
          this.paintPacket(this.wid, coding, image, x, y, w, h);
        }
      }
      return;
    }

    if (IMAGE_CODING.includes(coding)) {
      await this.imageDecoder.convertToBitmap(packet);
    } else if (VIDEO_CODING.includes(coding)) {
      if (!this.videoDecoder) {
        this.decodeError(packet, "video decoder not available");
        return;
      }
      if (!this.videoDecoder.isInitialized) {
        this.videoDecoder.init(coding);
      }
      try {
        await this.videoDecoder.queueFrame(packet);
      } catch (error) {
        this.decodeError(packet, String(error));
        return;
      }
    } else {
      this.decodeError(packet, `unsupported encoding: '${coding}'`);
      return;
    }

    // Throttle: hold 500ms to prevent flooding
    if (packet[6] === "throttle") {
      await new Promise((r) => setTimeout(r, 500));
    }

    this.postDrawAck(packet, start);

    if (packet[6] === "throttle") return;

    const wid = packet[1];
    const x = packet[2];
    const y = packet[3];
    const w = packet[4];
    const h = packet[5];
    coding = packet[6];
    const image = packet[7];
    this.paintPacket(wid, coding, image, x, y, w, h);
  }

  private postDrawAck(packet: DrawPacket, start: number): void {
    const options = (packet[10] ?? {}) as Record<string, unknown>;
    const decodeTime = Math.round(1000 * (performance.now() - start));
    options["decode_time"] = Math.max(0, decodeTime);

    const clone: DrawPacket = [...packet] as DrawPacket;
    clone[7] = undefined;
    clone[6] = "offscreen-painted";
    clone[10] = options;

    const msg: OffscreenWorkerOutbound = { draw: clone, start };
    self.postMessage(msg);
  }

  private paintPacket(
    wid: number,
    coding: string,
    image: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    let painted = false;
    try {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          this.doPaintPacket(wid, coding, image, x, y, width, height);
        });
        painted = true;
      }
    } catch {
      console.error("requestAnimationFrame error for paint packet");
      painted = false;
    }
    if (!painted) {
      this.doPaintPacket(wid, coding, image, x, y, width, height);
    }
  }

  private doPaintPacket(
    _wid: number,
    coding: string,
    image: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.canvas || !this.ctx) return;

    if (coding.startsWith("bitmap")) {
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.clearRect(x, y, width, height);
      this.ctx.drawImage(
        image as CanvasImageSource,
        0,
        0,
        width,
        height,
        x,
        y,
        width,
        height,
      );
      this.paintBox(coding, x, y, width, height);
    } else if (coding === "scroll") {
      const scrollData = image as ScrollData[];
      this.ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < scrollData.length; i++) {
        const [sx, sy, sw, sh, xdelta, ydelta] = scrollData[i];
        this.ctx.drawImage(
          this.canvas,
          sx,
          sy,
          sw,
          sh,
          sx + xdelta,
          sy + ydelta,
          sw,
          sh,
        );
        this.paintBox(coding, sx, sy, sw, sh);
      }
    } else if (coding.startsWith("frame")) {
      this.ctx.drawImage(
        image as CanvasImageSource,
        0,
        0,
        width,
        height,
        x,
        y,
        width,
        height,
      );
      const vf = image as VideoFrame;
      if (typeof vf?.close === "function") vf.close();
      this.paintBox(coding, x, y, width, height);
    }
  }

  private paintBox(
    coding: string,
    px: number,
    py: number,
    pw: number,
    ph: number,
  ): void {
    if (!this.debug || !this.ctx) return;
    const sourceEncoding = coding.split(":")[1] ?? "";
    const boxColor = DEFAULT_BOX_COLORS[sourceEncoding];
    if (boxColor) {
      this.ctx.strokeStyle = boxColor;
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px, py, pw, ph);
    }
  }

  updateGeometry(w: number, h: number): void {
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  redraw(): void {
    console.info("REDRAW requested");
  }

  eos(): void {
    const packet: DrawPacket = [
      "draw",
      this.wid,
      0,
      0,
      0,
      0,
      "eos",
      null,
      0,
      0,
      {},
    ];
    this.decodeQueue.push(packet);
    if (!this.decodeQueueDraining) {
      this.processDecodeQueue();
    }
  }

  close(): void {
    this.eos();
    this.canvas = null;
    this.decodeQueue = [];
    this.decodeQueueDraining = true;
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

const windowDecoders = new Map<number, WindowDecoder>();

function sendDecodeError(packet: DrawPacket, error: string): void {
  packet[7] = null;
  const msg: OffscreenWorkerOutbound = { error, packet };
  self.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener("message", (e: MessageEvent<OffscreenWorkerInbound>) => {
  const data = e.data;
  let wd: WindowDecoder | undefined;

  switch (data.c) {
    case "check": {
      const encodings = [...data.encodings];
      const common = encodings.filter((v) => ALL_ENCODINGS.has(v));
      const msg: OffscreenWorkerOutbound = {
        result: true,
        formats: common,
      };
      self.postMessage(msg);
      break;
    }
    case "eos":
      wd = windowDecoders.get(data.wid);
      if (wd) wd.eos();
      break;
    case "remove":
      wd = windowDecoders.get(data.wid);
      if (wd) {
        wd.close();
        windowDecoders.delete(data.wid);
      }
      break;
    case "decode": {
      const packet = data.packet;
      const wid = packet[1];
      wd = windowDecoders.get(wid);
      if (wd) {
        wd.queueDrawPacket(packet);
      } else {
        sendDecodeError(
          packet,
          `no window decoder found for wid ${wid}, only: ${[...windowDecoders.keys()].join(",")}`,
        );
      }
      break;
    }
    case "redraw":
      wd = windowDecoders.get(data.wid);
      if (wd) wd.redraw();
      break;
    case "canvas":
      if (data.canvas) {
        windowDecoders.set(
          data.wid,
          new WindowDecoder(data.wid, data.canvas, data.debug ?? false),
        );
      }
      break;
    case "canvas-geo":
      wd = windowDecoders.get(data.wid);
      if (wd) wd.updateGeometry(data.w, data.h);
      break;
    case "close":
      for (const decoder of windowDecoders.values()) {
        decoder.close();
      }
      windowDecoders.clear();
      break;
    default: {
      const _: never = data;
      console.error("offscreen decode worker got unknown message:", _);
    }
  }
});

export {};
