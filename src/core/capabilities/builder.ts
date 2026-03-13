/*
 * Author: Ali Parnan
 */

/**
 * Capabilities builder for Xpra hello handshake.
 * Ported from Client.js _make_hello, _make_hello_base, _get_*_caps.
 */

import { CHARCODE_TO_NAME } from "@/core/keycodes/key-maps";
import { getKeyboardLayout } from "@/core/utils/platform";
import {
  getConnectionInfo,
  getPlatformName,
  getPlatformProcessor,
  getSimpleUserAgentString,
} from "@/core/utils/platform";
import {
  getDPI,
  getDisplayCaps,
  getScreenSizes,
  type DisplayCaps,
} from "./display";
import { buildCipherCaps } from "@/core/protocol/encryption";
import { isBrotliReady } from "@/core/protocol/codec";
import { decompressBlock as lz4DecompressBlock } from "lz4js";
import type { Capabilities } from "@/core/protocol/types";
import {
  TEXT_PLAIN,
  TEXT_HTML,
  UTF8_STRING,
  CLIPBOARD_IMAGES,
} from "@/core/features/clipboard";

// ---------------------------------------------------------------------------
// Constants (from Client.js, Constants.js, Utilities.js)
// ---------------------------------------------------------------------------

export const METADATA_SUPPORTED = [
  "fullscreen",
  "maximized",
  "iconic",
  "above",
  "below",
  "title",
  "size-hints",
  "class-instance",
  "transient-for",
  "window-type",
  "has-alpha",
  "decorations",
  "override-redirect",
  "tray",
  "modal",
  "opacity",
  "desktop",
  "shadow",
] as const;

export const FILE_CHUNKS_SIZE = 128 * 1024;

export const RGB_FORMATS = ["RGBX", "RGBA", "RGB"] as const;

export const CLIENT_VERSION = "20";
export const CLIENT_REVISION = 0;
export const CLIENT_LOCAL_MODIFICATIONS = 0;
export const CLIENT_BRANCH = "v16.x";

// ---------------------------------------------------------------------------
// Input types for capability building
// ---------------------------------------------------------------------------

export interface EncodingOptions {
  "": string;
  icons: { max_size: [number, number]; greedy: boolean };
  transparency: boolean;
  rgb_lz4: boolean;
  "decoder-speed": { video: number };
  "color-gamut": string;
  video_scaling: boolean;
  video_max_size: [number, number];
  full_csc_modes: Record<string, string[]>;
  h264?: Record<string, unknown>;
  "h264+mp4"?: Record<string, unknown>;
  vp8?: Record<string, unknown>;
  mpeg4?: Record<string, unknown>;
  "vp8+webm"?: Record<string, unknown>;
  webp?: Record<string, unknown>;
  jpeg?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CapabilitiesBuilderInput {
  /** Container element for desktop dimensions */
  container: HTMLElement;
  /** Override keyboard layout (null = auto-detect from browser) */
  keyboardLayout: string | null;
  /** Supported encodings list */
  supportedEncodings: string[];
  /** Encoding options (icons, transparency, etc.) */
  encodingOptions: EncodingOptions;
  /** Audio codec names (keys of audio_codecs) */
  audioCodecs: string[];
  /** Clipboard enabled */
  clipboardEnabled: boolean;
  /** Clipboard poll mode */
  clipboardPoll: boolean;
  /** Preferred clipboard format */
  clipboardPreferredFormat: string;
  /** Printing enabled */
  printing: boolean;
  /** Open URL enabled */
  openUrl: boolean;
  /** Username for session */
  username: string;
  /** Session UUID */
  uuid: string;
  /** Sharing mode */
  sharing: boolean;
  /** Steal session */
  steal: boolean;
  /** Vertical refresh rate (-1 if unknown) */
  vrefresh: number;
  /** Bandwidth limit */
  bandwidthLimit: number;
  /** Start new session (null = no) */
  startNewSession: string | null;
  /** Encryption mode (e.g. "AES-CBC") or false */
  encryption: string | false;
  /** Encryption key (when encryption is used) */
  encryptionKey?: string;
  /** DPI element ID for measurement (optional) */
  dpiElementId?: string;
}

// ---------------------------------------------------------------------------
// Keycodes
// ---------------------------------------------------------------------------

/**
 * Build keycodes array for keymap caps.
 * Format: [[keyval, name, keycode, group, level], ...]
 */
export function getKeycodes(): [number, string, number, number, number][] {
  const keycodes: [number, string, number, number, number][] = [];
  for (const keycodeStr of Object.keys(CHARCODE_TO_NAME)) {
    const kc = Number.parseInt(keycodeStr, 10);
    keycodes.push([kc, CHARCODE_TO_NAME[kc as keyof typeof CHARCODE_TO_NAME], kc, 0, 0]);
  }
  return keycodes;
}

/**
 * Resolve keyboard layout: use override if set, else detect from browser.
 */
export function resolveKeyboardLayout(override: string | null): string {
  if (override) return override;
  return getKeyboardLayout();
}

// ---------------------------------------------------------------------------
// Individual capability getters
// ---------------------------------------------------------------------------

export function getEncodingCaps(
  encodingOptions: EncodingOptions,
): Record<string, unknown> {
  return encodingOptions as Record<string, unknown>;
}

export function getAudioCaps(
  audioCodecNames: string[],
): Record<string, unknown> {
  return {
    receive: true,
    send: true,
    decoders: audioCodecNames,
  };
}

export function getPointerCaps(): Record<string, unknown> {
  return {
    double_click: {},
  };
}

export function getClipboardCaps(
  enabled: boolean,
  _poll: boolean,
  preferredFormat: string,
): Record<string, unknown> {
  const nav = navigator as unknown as { clipboard?: { readText?: unknown; writeText?: unknown; write?: unknown } };
  const selections = ["CLIPBOARD", "PRIMARY"];

  const targets: string[] = [preferredFormat];
  for (const target of [TEXT_HTML, UTF8_STRING, "TEXT", "STRING", TEXT_PLAIN]) {
    if (target !== preferredFormat) {
      targets.push(target);
    }
  }
  if (CLIPBOARD_IMAGES && nav.clipboard && "write" in nav.clipboard) {
    targets.push("image/png");
  }

  return {
    enabled,
    want_targets: true,
    greedy: true,
    selections,
    "preferred-targets": targets,
  };
}

export function getKeymapCaps(
  layout: string,
  keycodes: [number, string, number, number, number][],
): Record<string, unknown> {
  return {
    layout,
    keycodes,
  };
}

export function getFileCaps(
  printing: boolean,
  openUrl: boolean,
): Record<string, unknown> {
  return {
    enabled: true,
    printing,
    "open-url": openUrl,
    "size-limit": 32 * 1024 * 1024,
  };
}

export function getDigests(): string[] {
  const digests = ["xor", "keycloak", "hmac+sha256"];
  if (typeof crypto !== "undefined" && crypto.subtle) {
    for (const hash of ["sha1", "sha256", "sha384", "sha512"]) {
      digests.push(`hmac+${hash}`);
    }
  }
  return digests;
}

export function getNetworkCaps(
  bandwidthLimit: number,
): Record<string, unknown> {
  const digests = getDigests();
  const connectionData = getConnectionInfo();
  return {
    digest: digests,
    "salt-digest": digests,
    compression_level: 1,
    rencodeplus: true,
    brotli: isBrotliReady(),
    lz4: typeof lz4DecompressBlock === "function",
    "bandwidth-limit": bandwidthLimit,
    "connection-data": connectionData,
    network: {
      pings: 5,
    },
  };
}

export function getBuildCaps(): Record<string, unknown> {
  return {
    revision: CLIENT_REVISION,
    local_modifications: CLIENT_LOCAL_MODIFICATIONS,
    branch: CLIENT_BRANCH,
  };
}

export function getPlatformCaps(): Record<string, unknown> {
  return {
    "": getPlatformName(),
    name: getPlatformName(),
    processor: getPlatformProcessor(),
    platform: navigator.appVersion,
  };
}

// ---------------------------------------------------------------------------
// Display caps (delegates to display.ts)
// ---------------------------------------------------------------------------

export function buildDisplayCaps(
  desktopWidth: number,
  desktopHeight: number,
  vrefresh: number,
  dpiElementId?: string,
): DisplayCaps {
  return getDisplayCaps(desktopWidth, desktopHeight, vrefresh, dpiElementId);
}

// ---------------------------------------------------------------------------
// Hello builders
// ---------------------------------------------------------------------------

/**
 * Merge capability objects into a base object.
 */
export function updateCapabilities(
  base: Capabilities,
  append: Record<string, unknown>,
): void {
  for (const key of Object.keys(append)) {
    (base as Record<string, unknown>)[key] = append[key];
  }
}

/**
 * Build base hello capabilities (version, display, build, platform, network, etc.).
 * Does NOT include encodings, keymap, clipboard, etc. — those go in makeHello.
 */
export function makeHelloBase(input: CapabilitiesBuilderInput): Capabilities {
  const desktopWidth = input.container.clientWidth || window.innerWidth || 1024;
  const desktopHeight = input.container.clientHeight || window.innerHeight || 768;
  console.log(
    "[xpra-display] makeHelloBase: container=%dx%d, window.inner=%dx%d, resolved=%dx%d",
    input.container.clientWidth, input.container.clientHeight,
    window.innerWidth, window.innerHeight,
    desktopWidth, desktopHeight,
  );
  const displayCaps = buildDisplayCaps(
    desktopWidth,
    desktopHeight,
    input.vrefresh,
    input.dpiElementId,
  );

  const caps: Capabilities = {};
  updateCapabilities(caps, {
    version: CLIENT_VERSION,
    client_type: "HTML5",
    display: displayCaps,
    build: getBuildCaps(),
    platform: getPlatformCaps(),
    "session-type": getSimpleUserAgentString(),
    "session-type.full": navigator.userAgent,
    username: input.username,
    uuid: input.uuid,
    argv: [window.location.href],
    share: input.sharing,
    steal: input.steal,
    "mouse.show": true,
    vrefresh: input.vrefresh,
    "file-chunks": FILE_CHUNKS_SIZE,
    "setting-change": true,
    "xdg-menu-update": true,
    "xdg-menu": true,
    control_commands: [
      "log",
      "redraw",
      "stop-audio",
      "toggle-keyboard",
      "toggle-float-menu",
      "toggle-window-preview",
    ],
  });
  updateCapabilities(caps, getNetworkCaps(input.bandwidthLimit));

  if (input.encryption) {
    const cipherCaps = buildCipherCaps(input.encryption);
    updateCapabilities(caps, {
      encryption: cipherCaps,
    });
  }

  if (input.startNewSession) {
    updateCapabilities(caps, {
      "start-new-session": input.startNewSession,
    });
  }

  return caps;
}

/**
 * Build full hello capabilities including encodings, keymap, clipboard, etc.
 * Call makeHelloBase first, then merge these on top.
 */
export function makeHello(input: CapabilitiesBuilderInput): Capabilities {
  const caps = makeHelloBase(input);
  const desktopWidth = input.container.clientWidth || window.innerWidth || 1024;
  const desktopHeight = input.container.clientHeight || window.innerHeight || 768;
  const keyLayout = resolveKeyboardLayout(input.keyboardLayout);
  const dpi = getDPI(input.dpiElementId);
  const screenSizes = getScreenSizes(desktopWidth, desktopHeight, dpi);

  const keycodes = getKeycodes();
  updateCapabilities(caps, {
    auto_refresh_delay: 150,
    "quality": 80,
    "min-quality": 50,
    "speed": 90,
    "min-speed": 70,
    "metadata.supported": [...METADATA_SUPPORTED],
    encodings: {
      "": input.supportedEncodings,
      core: input.supportedEncodings,
      rgb_formats: [...RGB_FORMATS],
      "window-icon": ["png"],
      cursor: ["png"],
      packet: true,
    },
    encoding: getEncodingCaps(input.encodingOptions),
    audio: getAudioCaps(input.audioCodecs),
    clipboard: getClipboardCaps(
      input.clipboardEnabled,
      input.clipboardPoll,
      input.clipboardPreferredFormat,
    ),
    pointer: getPointerCaps(),
    keymap: getKeymapCaps(keyLayout, keycodes),
    file: getFileCaps(input.printing, input.openUrl),
    wants: ["audio"],
    windows: true,
    "window.pre-map": true,
    keyboard: true,
    screen_sizes: screenSizes,
    dpi: { x: dpi, y: dpi },
    notifications: { enabled: true },
    cursors: true,
    bell: true,
    system_tray: true,
    named_cursors: false,
  });

  return caps;
}
