/*
 * Author: Ali Parnan
 *
 * Canvas rendering (paint, do_paint, swap_buffers) without jQuery.
 * Pure Canvas API for window contents.
 */

import type { DrawPacket } from "@/core/codec/rgb-helpers";
import { decode_rgb } from "@/core/codec/rgb-helpers";
import { DEFAULT_BOX_COLORS } from "@/core/constants/box-colors";
import { s } from "@/core/utils/encoding";
import { ArrayBufferToBase64 } from "@/core/utils/encoding";
import type { DecodeCallback, WindowRendererOptions } from "./types";

/**
 * WindowRenderer handles canvas-based rendering of Xpra window contents.
 * Implements double-buffering (offscreen canvas), paint queue, and
 * swap_buffers for smooth updates. No jQuery – pure Canvas API.
 */
export class WindowRenderer {
  private readonly canvas: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private drawCanvas: HTMLCanvasElement;
  private _width: number;
  private _height: number;
  private readonly debugCategories: readonly string[];
  private readonly useDecodeWorker: boolean;
  private readonly debug: (category: string, ...args: unknown[]) => void;
  private readonly error: (...args: unknown[]) => void;
  private readonly exc: (...args: unknown[]) => void;
  private readonly stretchSmallContent: boolean;

  private paintQueue: unknown[][] = [];
  private paintPending = 0;
  private _dirty = false;
  private _awaitingFullFrame = false;
  private _awaitingFullFrameTimer = 0;
  private scrollSnapshot: HTMLCanvasElement;
  private scrollSnapshotCtx: CanvasRenderingContext2D;

  constructor(options: WindowRendererOptions) {
    this.canvas = options.canvas;
    this._width = options.width;
    this._height = options.height;
    void options.hasAlpha;
    void options.tray;
    this.debugCategories = options.debugCategories ?? [];
    this.useDecodeWorker = options.useDecodeWorker ?? false;
    this.stretchSmallContent = options.stretchSmallContent ?? false;
    this.debug = options.debug ?? (() => {});
    this.error = options.error ?? (() => {});
    this.exc = options.exc ?? (() => {});

    const ctx = this.canvas.getContext("2d", { desynchronized: true, alpha: false });
    if (!ctx) {
      throw new Error("WindowRenderer: failed to get 2d context");
    }
    this.canvasCtx = ctx;
    this.canvasCtx.imageSmoothingEnabled = false;

    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCanvas.width = this._width;
    this.offscreenCanvas.height = this._height;
    const offCtx = this.offscreenCanvas.getContext("2d");
    if (!offCtx) {
      throw new Error("WindowRenderer: failed to get offscreen 2d context");
    }
    this.offscreenCtx = offCtx;
    this.offscreenCtx.imageSmoothingEnabled = false;

    this.drawCanvas = this.offscreenCanvas;

    this.scrollSnapshot = document.createElement("canvas");
    this.scrollSnapshot.width = this._width;
    this.scrollSnapshot.height = this._height;
    this.scrollSnapshotCtx = this.scrollSnapshot.getContext("2d")!;
  }

  /** Current content width. */
  get width(): number {
    return this._width;
  }

  /** Current content height. */
  get height(): number {
    return this._height;
  }

  /** Update canvas dimensions. Call when window is resized. */
  updateCanvasGeometry(width: number, height: number): void {
    if (width === this._width && height === this._height) return;

    this.paintQueue.length = 0;
    this.paintPending = 0;

    const newOff = document.createElement("canvas");
    newOff.width = width;
    newOff.height = height;
    const newCtx = newOff.getContext("2d")!;
    newCtx.imageSmoothingEnabled = false;

    // Immer vorhandenen Inhalt strecken statt schwarzen Bereich zeigen (kein harter Refresh)
    if (this._width > 0 && this._height > 0) {
      newCtx.imageSmoothingEnabled = true;
      newCtx.drawImage(
        this.offscreenCanvas,
        0, 0, this._width, this._height,
        0, 0, width, height,
      );
      newCtx.imageSmoothingEnabled = false;
    }

    this.offscreenCanvas = newOff;
    this.offscreenCtx = newCtx;
    this.drawCanvas = newOff;

    this._width = width;
    this._height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvasCtx.imageSmoothingEnabled = false;
    this.scrollSnapshot.width = width;
    this.scrollSnapshot.height = height;
    this.scrollSnapshotCtx = this.scrollSnapshot.getContext("2d")!;
    this._awaitingFullFrame = true;
    if (this._awaitingFullFrameTimer) clearTimeout(this._awaitingFullFrameTimer);
    this._awaitingFullFrameTimer = window.setTimeout(() => {
      this._awaitingFullFrame = false;
      this._awaitingFullFrameTimer = 0;
    }, 500);
    this._dirty = true;
    // Sofort zeichnen, damit kein schwarzer Frame vor dem naechsten rAF erscheint
    this.canvasCtx.drawImage(this.drawCanvas, 0, 0);
  }

  /**
   * Re-initialize the offscreen canvas and copy current draw buffer into it.
   * Called after a frame is complete (e.g. from decode worker).
   */
  swap_buffers(): void {
    this.debug("draw", "swap_buffers");
    this.drawCanvas = this.offscreenCanvas;
    this.init_offscreen_canvas();
    this.offscreenCtx.drawImage(this.drawCanvas, 0, 0);
    this._dirty = true;
  }

  private init_offscreen_canvas(): void {
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCanvas.width = this._width;
    this.offscreenCanvas.height = this._height;
    const ctx = this.offscreenCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("WindowRenderer: failed to get new offscreen 2d context");
    }
    this.offscreenCtx = ctx;
    this.offscreenCtx.imageSmoothingEnabled = false;
  }

  /** Mark the renderer as needing a redraw on the next rAF tick. */
  markDirty(): void {
    this._dirty = true;
  }

  /**
   * Draw the current buffer to the visible canvas.
   * Typically called from requestAnimationFrame. Skips if nothing changed.
   */
  draw(): void {
    if (!this._dirty) return;
    this._dirty = false;
    this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvasCtx.drawImage(this.drawCanvas, 0, 0);
  }

  /**
   * Queue or directly execute a paint operation.
   * With decode worker: calls do_paint immediately.
   * Without: enqueues and processes via may_paint_now.
   */
  paint(packet: DrawPacket, decodeCallback: DecodeCallback): void {
    if (this.useDecodeWorker) {
      this.do_paint(packet, decodeCallback);
      return;
    }
    this.paintQueue.push([packet, decodeCallback]);
    this.may_paint_now();
  }

  /**
   * Process paint queue items when not already painting.
   */
  may_paint_now(): void {
    this.debug(
      "draw",
      "may_paint_now() paint pending=",
      this.paintPending,
      ", paint queue length=",
      this.paintQueue.length,
    );
    let now = performance.now();
    while (
      (this.paintPending === 0 || now - this.paintPending >= 2000) &&
      this.paintQueue.length > 0
    ) {
      this.paintPending = now;
      const item = this.paintQueue.shift() as [DrawPacket, DecodeCallback];
      this.do_paint(item[0], item[1]);
      now = performance.now();
    }
  }

  private paint_box(color: string, px: number, py: number, pw: number, ph: number): void {
    this.offscreenCtx.strokeStyle = color;
    this.offscreenCtx.lineWidth = 2;
    this.offscreenCtx.strokeRect(px, py, pw, ph);
  }

  private construct_base64_image_url(encoding: string, imageData: Uint8Array | ArrayBuffer): string {
    const data = imageData instanceof ArrayBuffer ? new Uint8Array(imageData) : imageData;
    const base64 = ArrayBufferToBase64(data);
    return `data:image/${encoding};base64,${base64}`;
  }

  /**
   * Paint decoded or raw pixel data onto the offscreen canvas.
   */
  do_paint(packet: DrawPacket, decodeCallback: DecodeCallback): void {
    const x = packet[2];
    const y = packet[3];
    const width = packet[4];
    const height = packet[5];
    const imgData = packet[7];
    const options = (packet[10] ?? {}) as Record<string, unknown>;
    let coding = s(packet[6]);
    let encWidth = width;
    let encHeight = height;

    if (this._awaitingFullFrame) {
      if (coding === "scroll") {
        this.paintPending = 0;
        this._dirty = true;
        decodeCallback();
        this.may_paint_now();
        return;
      }
      this._awaitingFullFrame = false;
      if (this._awaitingFullFrameTimer) {
        clearTimeout(this._awaitingFullFrameTimer);
        this._awaitingFullFrameTimer = 0;
      }
    }

    const scaledSize = options["scaled_size"] as [number, number] | undefined;
    if (scaledSize) {
      encWidth = scaledSize[0];
      encHeight = scaledSize[1];
    }

    const bitmap = coding.startsWith("bitmap:");
    if (bitmap) {
      coding = coding.split(":")[1] ?? coding;
      this.debug("draw", coding, imgData, " at ", `${x},${y}`, ")");
    } else {
      const len = imgData && typeof (imgData as Uint8Array).length === "number"
        ? (imgData as Uint8Array).length
        : 0;
      this.debug(
        "draw",
        "do_paint(",
        len,
        " bytes of",
        coding,
        " data ",
        width,
        "x",
        height,
        " at ",
        x,
        ",",
        y,
        ")",
      );
    }

    const painted = (skipBox: boolean): void => {
      this.paintPending = 0;
      this._dirty = true;
      if (!skipBox && this.debugCategories.includes("draw")) {
        const color = DEFAULT_BOX_COLORS[coding] ?? "white";
        this.paint_box(color, x, y, width, height);
      }
      decodeCallback();
    };

    const shouldScaleToFill = (): boolean =>
      this.stretchSmallContent &&
      x === 0 &&
      y === 0 &&
      width < this._width &&
      height < this._height &&
      width >= this._width * 0.4 &&
      height >= this._height * 0.4;

    const paintError = (e: unknown): void => {
      this.error("error painting", coding, e);
      this.paintPending = 0;
      decodeCallback(String(e));
    };

    const paintBitmap = (): void => {
      const w = (imgData as ImageBitmap).width;
      const h = (imgData as ImageBitmap).height;
      this.offscreenCtx.clearRect(x, y, w, h);
      if (shouldScaleToFill()) {
        this.offscreenCtx.imageSmoothingEnabled = true;
        this.offscreenCtx.drawImage(imgData as ImageBitmap, 0, 0, w, h, 0, 0, this._width, this._height);
        this.offscreenCtx.imageSmoothingEnabled = false;
      } else {
        this.offscreenCtx.drawImage(imgData as ImageBitmap, x, y);
      }
      painted(false);
      this.may_paint_now();
    };

    try {
      if (!coding || coding === "void") {
        painted(true);
        this.may_paint_now();
        return;
      }

      if (coding === "rgb32" || coding === "rgb24") {
        if (bitmap) {
          paintBitmap();
          return;
        }
        const rgbData = decode_rgb(packet);
        const img = this.offscreenCtx.createImageData(encWidth, encHeight);
        img.data.set(rgbData);
        if (shouldScaleToFill()) {
          const tmp = document.createElement("canvas");
          tmp.width = encWidth;
          tmp.height = encHeight;
          const tmpCtx = tmp.getContext("2d")!;
          tmpCtx.putImageData(img, 0, 0);
          this.offscreenCtx.imageSmoothingEnabled = true;
          this.offscreenCtx.drawImage(tmp, 0, 0, encWidth, encHeight, 0, 0, this._width, this._height);
          this.offscreenCtx.imageSmoothingEnabled = false;
        } else {
          this.offscreenCtx.putImageData(img, x, y, 0, 0, encWidth, encHeight);
        }
        painted(false);
        this.may_paint_now();
        return;
      }

      if (coding === "jpeg" || coding.startsWith("png") || coding === "webp" || coding === "avif") {
        if (bitmap) {
          paintBitmap();
          return;
        }
        const image = new Image();
        image.addEventListener("load", () => {
          if (image.width === 0 || image.height === 0) {
            paintError(`invalid image size: ${image.width}x${image.height}`);
          } else {
            this.offscreenCtx.clearRect(x, y, width, height);
            if (shouldScaleToFill()) {
              this.offscreenCtx.imageSmoothingEnabled = true;
              this.offscreenCtx.drawImage(image, 0, 0, width, height, 0, 0, this._width, this._height);
              this.offscreenCtx.imageSmoothingEnabled = false;
            } else {
              this.offscreenCtx.drawImage(image, x, y, width, height);
            }
            painted(false);
          }
          this.may_paint_now();
        });
        image.onerror = () => {
          paintError(`failed to load ${coding} into image tag`);
          this.may_paint_now();
        };
        const paintCoding = coding.split("/")[0] ?? coding;
        const data = imgData as Uint8Array | ArrayBuffer;
        image.src = this.construct_base64_image_url(paintCoding, data);
        return;
      }

      if (coding === "h264") {
        paintError("h264 decoding is only supported via the decode workers");
        this.may_paint_now();
        return;
      }

      if (coding === "scroll") {
        const scrolls = (options["scroll"] ?? imgData) as number[][];
        this.scrollSnapshotCtx.drawImage(this.offscreenCanvas, 0, 0);

        for (let index = 0; index < scrolls.length; index++) {
          const scrollData = scrolls[index];
          this.debug("draw", "scroll", index, ":", scrollData);
          const [sx, sy, sw, sh, xdelta, ydelta] = scrollData;
          if (sw <= 0 || sh <= 0) continue;
          this.offscreenCtx.drawImage(
            this.scrollSnapshot,
            sx, sy, sw, sh,
            sx + xdelta, sy + ydelta, sw, sh,
          );
          if (this.debugCategories.includes("draw")) {
            this.paint_box("brown", sx + xdelta, sy + ydelta, sw, sh);
          }
        }
        painted(true);
        this.may_paint_now();
        return;
      }

      paintError(`unsupported encoding: '${coding}'`);
    } catch (err) {
      const packetSequence = packet[8];
      this.exc(err, "error painting", coding, "sequence no", packetSequence);
      paintError(err);
    }
  }
}
