/*
 * Author: Ali Parnan
 */

/** Callback invoked when a paint operation completes (for damage sequence). */
export type DecodeCallback = (error?: string) => void;

/** Options for creating a WindowRenderer. */
export interface WindowRendererOptions {
  /** The visible canvas element to draw to. */
  readonly canvas: HTMLCanvasElement;
  /** Initial width of the window content. */
  readonly width: number;
  /** Initial height of the window content. */
  readonly height: number;
  /** Whether the window has alpha (affects clear before draw). */
  readonly hasAlpha?: boolean;
  /** Whether this is a tray window (affects clear before draw). */
  readonly tray?: boolean;
  /** Debug categories to enable (e.g. ["draw"]). */
  readonly debugCategories?: readonly string[];
  /** If true, paint() bypasses the queue and calls do_paint directly. */
  readonly useDecodeWorker?: boolean;
  /** If true (desktop), scale incoming draws smaller than canvas to fill (kein schwarzer Balken). */
  readonly stretchSmallContent?: boolean;
  /** Debug logging callback. */
  readonly debug?: (category: string, ...args: unknown[]) => void;
  /** Error logging callback. */
  readonly error?: (...args: unknown[]) => void;
  /** Exception logging callback. */
  readonly exc?: (...args: unknown[]) => void;
}
