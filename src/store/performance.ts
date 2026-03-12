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
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type PresetId = "sharp" | "balanced" | "fast" | "low-bandwidth";

export interface PerfPreset {
  id: PresetId;
  label: string;
  subtitle: string;
  description: string;
  values: Readonly<PerformanceSettings>;
}

export const PERF_PRESETS: readonly PerfPreset[] = [
  {
    id: "sharp",
    label: "Sharp",
    subtitle: "LAN / fast network",
    description: "Best image clarity, uses more bandwidth",
    values: { quality: 100, minQuality: 80, speed: 70, minSpeed: 50, autoRefreshDelay: 100 },
  },
  {
    id: "balanced",
    label: "Balanced",
    subtitle: "default",
    description: "Good trade-off between clarity and responsiveness",
    values: { quality: 80, minQuality: 50, speed: 90, minSpeed: 70, autoRefreshDelay: 150 },
  },
  {
    id: "fast",
    label: "Fast",
    subtitle: "slow network / VPN",
    description: "Smooth interaction, reduced sharpness during motion",
    values: { quality: 60, minQuality: 30, speed: 100, minSpeed: 90, autoRefreshDelay: 300 },
  },
  {
    id: "low-bandwidth",
    label: "Low Bandwidth",
    subtitle: "very slow",
    description: "Minimum data usage, noticeably reduced quality",
    values: { quality: 40, minQuality: 10, speed: 100, minSpeed: 95, autoRefreshDelay: 500 },
  },
] as const;

const PRESET_KEYS: readonly (keyof PerformanceSettings)[] = [
  "quality", "minQuality", "speed", "minSpeed", "autoRefreshDelay",
];

/** Return the preset whose values exactly match `settings`, or `null`. */
export function matchPreset(settings: PerformanceSettings): PresetId | null {
  for (const preset of PERF_PRESETS) {
    if (PRESET_KEYS.every((k) => preset.values[k] === settings[k])) {
      return preset.id;
    }
  }
  return null;
}

/** Look up a preset by id. */
export function getPreset(id: PresetId): PerfPreset {
  return PERF_PRESETS.find((p) => p.id === id)!;
}

// ---------------------------------------------------------------------------
// Defaults (= "Balanced" preset)
// ---------------------------------------------------------------------------

export const PERF_DEFAULTS: Readonly<PerformanceSettings> = {
  ...getPreset("balanced").values,
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
