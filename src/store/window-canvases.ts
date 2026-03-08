/*
 * Author: Ali Parnan
 *
 * Window canvas registry — Maps window IDs to canvas elements for WindowPreview thumbnails.
 * Phase 6b-3: WindowPreview component.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const [canvasMap, setCanvasMap] = createSignal<Record<number, HTMLCanvasElement>>({});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function registerWindowCanvas(wid: number, canvas: HTMLCanvasElement): void {
  setCanvasMap((prev) => ({ ...prev, [wid]: canvas }));
}

export function unregisterWindowCanvas(wid: number): void {
  setCanvasMap((prev) => {
    const next = { ...prev };
    delete next[wid];
    return next;
  });
}

export function getWindowCanvas(wid: number): HTMLCanvasElement | undefined {
  return canvasMap()[wid];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const windowCanvasStore = {
  get map() {
    return canvasMap();
  },
  registerWindowCanvas,
  unregisterWindowCanvas,
  getWindowCanvas,
};
