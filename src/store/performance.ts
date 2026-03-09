/*
 * Author: Ali Parnan
 *
 * Performance store — Tunable performance parameters.
 * Values are used in the capabilities handshake and at runtime
 * for decoder/renderer throttling.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerformanceSettings {
  /** Encoding quality sent to server (1–100) */
  quality: number;
  /** Minimum quality the server may drop to (1–100) */
  minQuality: number;
  /** Encoding speed preference (1–100) */
  speed: number;
  /** Minimum encoding speed (1–100) */
  minSpeed: number;
  /** Lossless auto-refresh delay in ms after region becomes static */
  autoRefreshDelay: number;
  /** Max video resolution the server may use (width) */
  videoMaxWidth: number;
  /** Max video resolution the server may use (height) */
  videoMaxHeight: number;
  /** Allow server to downscale video before encoding */
  videoScaling: boolean;
  /** Video decoder frame-queue threshold before throttling */
  frameThreshold: number;
  /** Paint-pending timeout in ms (renderer) */
  paintTimeout: number;
  /** Resize quality for scaled bitmaps */
  resizeQuality: "low" | "medium" | "high";
  /** Network compression level (0–9) */
  compressionLevel: number;
  /** Bandwidth limit in bytes/s (0 = unlimited) */
  bandwidthLimit: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const PERF_DEFAULTS: Readonly<PerformanceSettings> = {
  quality: 80,
  minQuality: 50,
  speed: 90,
  minSpeed: 70,
  autoRefreshDelay: 150,
  videoMaxWidth: 4096,
  videoMaxHeight: 2160,
  videoScaling: true,
  frameThreshold: 250,
  paintTimeout: 2000,
  resizeQuality: "medium",
  compressionLevel: 1,
  bandwidthLimit: 0,
};

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

const [perfSettings, setPerfSettings] = createSignal<PerformanceSettings>({
  ...PERF_DEFAULTS,
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function updatePerfSettings(
  partial: Partial<PerformanceSettings>,
): void {
  setPerfSettings((prev) => ({ ...prev, ...partial }));
}

export function resetPerfSettings(): void {
  setPerfSettings({ ...PERF_DEFAULTS });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { perfSettings };

export const performanceStore = {
  get settings() {
    return perfSettings();
  },
  updatePerfSettings,
  resetPerfSettings,
};
