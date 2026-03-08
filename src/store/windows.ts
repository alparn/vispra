/*
 * Author: Ali Parnan
 */

/**
 * Windows store — Window Registry.
 * Manages the map of window IDs to window state.
 * Ported from Client.js id_to_window and focused_wid.
 */

import { createSignal } from "solid-js";
import type { WindowMetadata } from "@/core/protocol/types";

// ---------------------------------------------------------------------------
// Window state (UI-facing, not the full XpraWindow instance)
// ---------------------------------------------------------------------------

export type WindowAppHint = "terminal" | "browser" | "rdp" | "unknown";

export interface WindowState {
  wid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: WindowMetadata;
  overrideRedirect: boolean;
  tray: boolean;
  clientProperties?: Record<string, unknown>;
  /** Display title from metadata */
  title?: string;
  /** Window type(s) from metadata */
  windowType?: string[];
  /** WM class-instance tuple, e.g. ["XTerm", "xterm"] */
  classInstance?: string[];
  /** Detected application type */
  appHint: WindowAppHint;
  fullscreen?: boolean;
  minimized?: boolean;
  maximized?: boolean;
  stackingLayer?: number;
}

const TERMINAL_CLASSES = ["xterm", "urxvt", "rxvt", "konsole", "gnome-terminal", "alacritty", "kitty", "st", "terminator", "tilix", "sakura", "terminology"];
const BROWSER_CLASSES = ["firefox", "chromium", "google-chrome", "brave-browser", "opera", "vivaldi", "epiphany"];
const RDP_CLASSES = ["xfreerdp", "freerdp", "rdesktop", "remmina"];

export function detectAppHint(metadata: WindowMetadata): WindowAppHint {
  const ci = metadata["class-instance"] as string[] | undefined;
  if (!ci || ci.length < 2) return "unknown";
  const cls = ci[1].toLowerCase();
  if (TERMINAL_CLASSES.some((t) => cls.includes(t))) return "terminal";
  if (RDP_CLASSES.some((r) => cls.includes(r))) return "rdp";
  if (BROWSER_CLASSES.some((b) => cls.includes(b))) return "browser";
  const title = ((metadata.title as string) ?? "").toLowerCase();
  if (title.includes("freerdp") || title.includes("rdp")) return "rdp";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const [windows, setWindows] = createSignal<Record<number, WindowState>>({});
export const [focusedWid, setFocusedWid] = createSignal(0);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function addWindow(
  wid: number,
  x: number,
  y: number,
  width: number,
  height: number,
  metadata: WindowMetadata,
  overrideRedirect: boolean,
  tray: boolean,
  clientProperties?: Record<string, unknown>,
): void {
  const title = metadata.title as string | undefined;
  const windowType = metadata["window-type"] as string[] | undefined;
  const classInstance = metadata["class-instance"] as string[] | undefined;
  const appHint = detectAppHint(metadata);
  const fullscreen = metadata.fullscreen as boolean | undefined;
  const minimized = metadata.iconic as boolean | undefined;
  const maximized = metadata.maximized as boolean | undefined;
  const stackingLayer = metadata["stacking-layer"] as number | undefined;

  console.log(`[window-store] addWindow wid=${wid} class-instance=`, classInstance, `appHint=${appHint}`);

  const state: WindowState = {
    wid,
    x,
    y,
    width,
    height,
    metadata,
    overrideRedirect,
    tray,
    clientProperties,
    title,
    windowType,
    classInstance,
    appHint,
    fullscreen,
    minimized,
    maximized,
    stackingLayer,
  };

  setWindows((prev) => ({ ...prev, [wid]: state }));
}

export function removeWindow(wid: number): void {
  setWindows((prev) => {
    const next = { ...prev };
    delete next[wid];
    return next;
  });
  setFocusedWid((current) => (current === wid ? 0 : current));
}

export function updateWindow(
  wid: number,
  updates: Partial<Pick<WindowState, "x" | "y" | "width" | "height" | "metadata">>,
): void {
  setWindows((prev) => {
    const win = prev[wid];
    if (!win) return prev;
    const mergedMeta = updates.metadata
      ? { ...win.metadata, ...updates.metadata }
      : win.metadata;
    if (updates.metadata?.["class-instance"]) {
      const newHint = detectAppHint(mergedMeta);
      console.log(`[window-store] updateWindow wid=${wid} class-instance=`, mergedMeta["class-instance"], `appHint=${newHint}`);
    }
    const next = { ...prev };
    next[wid] = {
      ...win,
      ...updates,
      metadata: mergedMeta,
      title: (mergedMeta.title ?? win.title) as string | undefined,
      windowType: (mergedMeta["window-type"] ?? win.windowType) as string[] | undefined,
      classInstance: (mergedMeta["class-instance"] ?? win.classInstance) as string[] | undefined,
      appHint: mergedMeta["class-instance"] ? detectAppHint(mergedMeta) : win.appHint,
      fullscreen: (mergedMeta.fullscreen ?? win.fullscreen) as boolean | undefined,
      minimized: (mergedMeta.iconic ?? win.minimized) as boolean | undefined,
      maximized: (mergedMeta.maximized ?? win.maximized) as boolean | undefined,
    };
    return next;
  });
}

export function updateWindowGeometry(
  wid: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  setWindows((prev) => {
    const win = prev[wid];
    if (!win) return prev;
    const next = { ...prev };
    next[wid] = { ...win, x, y, width, height };
    return next;
  });
}

/** Update only metadata for a window. */
export function updateWindowMetadata(
  wid: number,
  metadata: WindowMetadata,
): void {
  updateWindow(wid, { metadata });
}

/** Set stacking layer for a window. */
export function setStackingLayer(wid: number, layer: number): void {
  setWindows((prev) => {
    const win = prev[wid];
    if (!win) return prev;
    const next = { ...prev };
    next[wid] = { ...win, stackingLayer: layer };
    return next;
  });
}

/** Alias for updateWindow (used by client). */
export function setWindow(
  wid: number,
  updates: Partial<Pick<WindowState, "x" | "y" | "width" | "height" | "metadata" | "stackingLayer">>,
): void {
  updateWindow(wid, updates);
  if (updates.stackingLayer !== undefined) {
    setStackingLayer(wid, updates.stackingLayer);
  }
}

/** Alias for clearAllWindows (used by client). */
export function clear(): void {
  clearAllWindows();
}

export function setFocusedWindow(wid: number): void {
  setFocusedWid(wid);
}

export function clearAllWindows(): void {
  setWindows({});
  setFocusedWid(0);
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

export function getWindow(wid: number): WindowState | undefined {
  return windows()[wid];
}

export function getWindowIds(): number[] {
  return Object.keys(windows()).map(Number);
}

export function getWindowCount(): number {
  return Object.keys(windows()).length;
}

/** Windows sorted by stacking layer (bottom to top). */
export function getWindowsSortedByStacking(): WindowState[] {
  return Object.values(windows()).sort(
    (a, b) => (a.stackingLayer ?? 0) - (b.stackingLayer ?? 0),
  );
}

/** Bring window to top of stacking order. */
export function raiseWindow(wid: number): void {
  const current = windows();
  const win = current[wid];
  if (!win) return;

  const topLayer =
    Object.values(current).reduce(
      (max, w) => Math.max(max, w.stackingLayer ?? 0),
      0,
    ) + 1;

  setWindows((prev) => ({
    ...prev,
    [wid]: { ...prev[wid], stackingLayer: topLayer },
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function getFocusedAppHint(): WindowAppHint {
  const wid = focusedWid();
  if (!wid) return "unknown";
  return windows()[wid]?.appHint ?? "unknown";
}

export const windowsStore = {
  get windows() {
    return windows();
  },
  get focusedWid() {
    return focusedWid();
  },
  get focusedWindow() {
    const wid = focusedWid();
    return wid ? windows()[wid] : undefined;
  },
  getFocusedAppHint,
  addWindow,
  removeWindow,
  updateWindow,
  updateWindowGeometry,
  setFocusedWindow,
  clearAllWindows,
  clear,
  setWindow,
  updateWindowMetadata,
  setStackingLayer,
  getWindow,
  getWindowIds,
  getWindowCount,
  getWindowsSortedByStacking,
  raiseWindow,
};
