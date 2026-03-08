/*
 * Author: Ali Parnan
 */

/**
 * Settings store — Typed client settings.
 * Ported from Client.js init_settings and init_encodings.
 */

import { createSignal } from "solid-js";
import { getparam } from "@/core/utils/storage";
import { isMacOS } from "@/core/utils/platform";
import { getColorGamut } from "@/core/utils/platform";

// ---------------------------------------------------------------------------
// Connection settings
// ---------------------------------------------------------------------------

export interface ConnectionSettings {
  host: string | null;
  port: number | null;
  ssl: boolean | null;
  webtransport: boolean;
  path: string;
  username: string;
  uri: string;
  insecure: boolean;
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export interface FeatureSettings {
  sharing: boolean;
  openUrl: boolean;
  steal: boolean;
  remoteLogging: boolean;
  debugCategories: string[];
  clipboardEnabled: boolean;
  clipboardPoll: boolean;
  clipboardPreferredFormat: string;
  fileTransfer: boolean;
  printing: boolean;
  keyboardLayout: string | null;
}

// ---------------------------------------------------------------------------
// Display / encoding settings
// ---------------------------------------------------------------------------

export interface DisplaySettings {
  scale: number;
  vrefresh: number;
  bandwidthLimit: number;
  encoding: string;
  supportedEncodings: string[];
  tryGpu: boolean;
}

// ---------------------------------------------------------------------------
// Reconnect settings
// ---------------------------------------------------------------------------

export interface ReconnectSettings {
  reconnect: boolean;
  reconnectCount: number;
  reconnectDelay: number;
}

// ---------------------------------------------------------------------------
// Timeouts (ms)
// ---------------------------------------------------------------------------

export interface TimeoutSettings {
  helloTimeout: number;
  openTimeout: number;
  pingTimeout: number;
  pingGrace: number;
  pingFrequency: number;
  infoFrequency: number;
}

// ---------------------------------------------------------------------------
// Input settings
// ---------------------------------------------------------------------------

export interface InputSettings {
  swapKeys: boolean;
  scrollReverseX: boolean;
  scrollReverseY: string;
  middleEmulationModifier: string;
  middleEmulationButton: number;
}

// ---------------------------------------------------------------------------
// Full settings
// ---------------------------------------------------------------------------

export interface ClientSettings
  extends ConnectionSettings,
    FeatureSettings,
    DisplaySettings,
    ReconnectSettings,
    TimeoutSettings,
    InputSettings {
  offscreenApi: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function getBoolParam(prop: string, defaultValue: boolean): boolean {
  const v = getparam(prop);
  if (v === undefined) return defaultValue;
  const lower = String(v).toLowerCase();
  return lower === "true" || lower === "1" || lower === "yes";
}

function getStrParam(prop: string, defaultValue: string): string {
  const v = getparam(prop);
  return v !== undefined ? String(v) : defaultValue;
}

function getIntParam(prop: string, defaultValue: number): number {
  const v = getparam(prop);
  if (v === undefined) return defaultValue;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultValue : n;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const defaultSettings: ClientSettings = {
  host: null,
  port: null,
  ssl: null,
  webtransport: false,
  path: "",
  username: "",
  uri: "",
  insecure: false,
  sharing: false,
  openUrl: true,
  steal: true,
  remoteLogging: true,
  debugCategories: [],
  clipboardEnabled: true,
  clipboardPoll: false,
  clipboardPreferredFormat: "text/plain",
  fileTransfer: false,
  printing: false,
  keyboardLayout: null,
  scale: 1,
  vrefresh: -1,
  bandwidthLimit: 0,
  encoding: "auto",
  supportedEncodings: [
    "jpeg",
    "png",
    "png/P",
    "png/L",
    "webp",
    "avif",
    "rgb",
    "rgb32",
    "rgb24",
    "scroll",
    "void",
  ],
  tryGpu: true,
  reconnect: true,
  reconnectCount: 5,
  reconnectDelay: 1000,
  helloTimeout: 30_000,
  openTimeout: 10_000,
  pingTimeout: 15_000,
  pingGrace: 2000,
  pingFrequency: 5000,
  infoFrequency: 1000,
  swapKeys: isMacOS(),
  scrollReverseX: false,
  scrollReverseY: "auto",
  middleEmulationModifier: "",
  middleEmulationButton: 2,
  offscreenApi: false,
};

const [settings, setSettings] = createSignal<ClientSettings>({ ...defaultSettings });

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function updateSettings(partial: Partial<ClientSettings>): void {
  setSettings((prev) => ({ ...prev, ...partial }));
}

export function loadSettingsFromParams(): void {
  const s = { ...defaultSettings };
  s.host = getStrParam("server", "") || null;
  s.port = getIntParam("port", 0) || null;
  s.ssl = getBoolParam("ssl", window.location.protocol === "https:");
  s.webtransport = getBoolParam("webtransport", false);
  s.path = getStrParam("path", window.location.pathname);
  s.username = getStrParam("username", "");
  s.insecure = getBoolParam("insecure", false);
  s.sharing = getBoolParam("sharing", false);
  s.openUrl = getBoolParam("open_url", true);
  s.steal = getBoolParam("steal", true);
  s.remoteLogging = getBoolParam("remote_logging", true);
  s.clipboardEnabled = getBoolParam("clipboard", true);
  s.clipboardPoll = getBoolParam("clipboard_poll", false);
  s.clipboardPreferredFormat = getStrParam("clipboard_preferred_format", "text/plain");
  s.fileTransfer = getBoolParam("file_transfer", true);
  s.printing = getBoolParam("printing", true);
  s.keyboardLayout = getStrParam("keyboard_layout", "") || null;
  s.reconnect = getBoolParam("reconnect", true);
  s.reconnectCount = getIntParam("reconnect_count", 5);
  s.reconnectDelay = getIntParam("reconnect_delay", 1000);
  s.swapKeys = getBoolParam("swap_keys", isMacOS());
  s.scrollReverseX = getBoolParam("scroll_reverse_x", false);
  s.scrollReverseY = getStrParam("scroll_reverse_y", "auto");
  s.middleEmulationModifier = getStrParam("middle_emulation_modifier", "");

  const categories = ["main", "keyboard", "geometry", "mouse", "clipboard", "draw", "audio", "network", "file"];
  s.debugCategories = categories.filter((c) => getBoolParam(`debug_${c}`, false));

  setSettings(s);
}

export function resetSettings(): void {
  setSettings({ ...defaultSettings });
}

// ---------------------------------------------------------------------------
// Encoding options (from init_encodings)
// ---------------------------------------------------------------------------

export function getEncodingOptions(): Record<string, unknown> {
  const gamut = getColorGamut();
  return {
    "": settings().encoding,
    icons: { max_size: [30, 30], greedy: true },
    transparency: true,
    "decoder-speed": { video: 0 },
    "color-gamut": gamut,
    video_scaling: true,
    video_max_size: [4096, 2160],
    full_csc_modes: {
      mpeg1: ["YUV420P"],
      h264: ["YUV420P"],
      "mpeg4+mp4": ["YUV420P"],
      "h264+mp4": ["YUV420P"],
      "vp8+webm": ["YUV420P"],
      webp: ["BGRX", "BGRA"],
      jpeg: [
        "BGRX",
        "BGRA",
        "BGR",
        "RGBX",
        "RGBA",
        "RGB",
        "YUV420P",
        "YUV422P",
        "YUV444P",
      ],
      vp8: ["YUV420P"],
    },
    h264: {
      "score-delta": 100,
      YUV420P: {
        profile: "baseline",
        level: "4.1",
        cabac: false,
        "deblocking-filter": false,
        "fast-decode": true,
      },
    },
    "h264+mp4": { "score-delta": 80, YUV420P: { profile: "baseline", level: "4.1" } },
    vp8: { "score-delta": 70 },
    "mpeg4+mp4": { "score-delta": 40 },
    "vp8+webm": { "score-delta": 40 },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const settingsStore = {
  get settings() {
    return settings();
  },
  updateSettings,
  loadSettingsFromParams,
  resetSettings,
  getEncodingOptions,
};
