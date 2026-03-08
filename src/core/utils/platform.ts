/*
 * Author: Ali Parnan
 */

import { LANGUAGE_TO_LAYOUT } from "../keycodes/key-maps";

export function getPlatformProcessor(): string {
  const nav = navigator as unknown as Record<string, unknown>;
  if (nav.oscpu) return nav.oscpu as string;
  if (nav.cpuClass) return nav.cpuClass as string;
  return "unknown";
}

export function getPlatformName(): string {
  const av = navigator.appVersion;
  if (av.includes("Win")) return "Microsoft Windows";
  if (av.includes("Mac")) return "Mac OSX";
  if (av.includes("Linux")) return "Linux";
  if (av.includes("X11")) return "Posix";
  return "unknown";
}

export function getFirstBrowserLanguage(): string | null {
  const nav = navigator as unknown as Record<string, unknown>;
  if (Array.isArray(nav.languages)) {
    for (const lang of nav.languages as string[]) {
      if (lang && lang.length > 0) return lang;
    }
  }
  for (const prop of [
    "language",
    "browserLanguage",
    "systemLanguage",
    "userLanguage",
  ]) {
    const val = nav[prop];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

export function getKeyboardLayout(): string {
  let v = getFirstBrowserLanguage();
  if (v === null) return "us";

  let layout = LANGUAGE_TO_LAYOUT[v];
  if (!layout) {
    v = v.split(",")[0];
    let parts = v.split("-", 2);
    if (parts.length === 1) parts = v.split("_", 2);
    layout = parts[0].toLowerCase();
    const mapped = LANGUAGE_TO_LAYOUT[layout];
    if (mapped) layout = mapped;
  }
  return layout;
}

export function isMacOS(): boolean {
  return navigator.platform.includes("Mac");
}

export function isWindows(): boolean {
  return navigator.platform.includes("Win");
}

export function isFirefox(): boolean {
  return navigator.userAgent.toLowerCase().includes("firefox");
}

export function isOpera(): boolean {
  return navigator.userAgent.toLowerCase().includes("opera");
}

export function isSafari(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("safari") && !ua.includes("chrome");
}

export function isWebkit(): boolean {
  return navigator.userAgent.toLowerCase().includes("webkit");
}

export function isEdge(): boolean {
  return navigator.userAgent.includes("Edge");
}

export function isChrome(): boolean {
  const win = window as unknown as Record<string, unknown>;
  const isChromium = "chrome" in win;
  const ua = navigator.userAgent;
  const isIOSChrome = /CriOS/.test(ua);
  if (isIOSChrome) return true;
  return (
    isChromium &&
    navigator.vendor === "Google Inc." &&
    !ua.includes("OPR") &&
    !ua.includes("Edge")
  );
}

export function isIE(): boolean {
  const ua = navigator.userAgent;
  return ua.includes("MSIE") || ua.includes("Trident/");
}

export function getBrowserName(): string {
  if (isFirefox()) return "Firefox";
  if (isOpera()) return "Opera";
  if (isChrome()) return "Chrome";
  if (isEdge()) return "Edge";
  if (isSafari()) return "Safari";
  return "Unknown";
}

export function getOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Windows NT")) return "MS Windows";
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS/iPadOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown";
}

export function is64bit(): boolean {
  const toCheck: string[] = [];
  const nav = navigator as unknown as Record<string, unknown>;
  if (nav.cpuClass) toCheck.push(String(nav.cpuClass).toLowerCase());
  if (navigator.platform) toCheck.push(navigator.platform.toLowerCase());
  if (navigator.userAgent) toCheck.push(navigator.userAgent.toLowerCase());

  const signatures = [
    "x86_64",
    "x86-64",
    "win64",
    "x64;",
    "amd64",
    "wow64",
    "x64_64",
    "ia64",
    "sparc64",
    "ppc64",
    "irix64",
  ];
  for (const a of toCheck) {
    for (const b of signatures) {
      if (a.includes(b)) return true;
    }
  }
  return false;
}

export function isMobile(): boolean {
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}

export function getSimpleUserAgentString(): string {
  if (isFirefox()) return "Firefox";
  if (isOpera()) return "Opera";
  if (isSafari()) return "Safari";
  if (isChrome()) return "Chrome";
  if (isIE()) return "MSIE";
  return "";
}

export function getColorGamut(): string {
  if (!window.matchMedia) return "";
  if (window.matchMedia("(color-gamut: rec2020)").matches) return "rec2020";
  if (window.matchMedia("(color-gamut: p3)").matches) return "P3";
  if (window.matchMedia("(color-gamut: srgb)").matches) return "srgb";
  return "";
}

export function isEventSupported(event: string): boolean {
  const el = document.createElement("div");
  const prop = `on${event}`;
  if (prop in el) return true;
  el.setAttribute(prop, "return;");
  return typeof (el as unknown as Record<string, unknown>)[prop] === "function";
}

export interface NormalizedWheel {
  spinX: number;
  spinY: number;
  pixelX: number;
  pixelY: number;
  deltaMode: number;
}

/**
 * Normalize mouse wheel events across browsers.
 * Based on https://github.com/facebook/fixed-data-table/blob/master/src/vendor_upstream/dom/normalizeWheel.js
 * BSD license.
 */
export function normalizeWheel(event: WheelEvent): NormalizedWheel {
  const PIXEL_STEP = 10;
  const LINE_HEIGHT = 40;
  const PAGE_HEIGHT = 800;

  let sX = 0;
  let sY = 0;

  const ev = event as unknown as Record<string, unknown>;
  if ("detail" in ev) sY = ev.detail as number;
  if ("wheelDelta" in ev) sY = -(ev.wheelDelta as number) / 120;
  if ("wheelDeltaY" in ev) sY = -(ev.wheelDeltaY as number) / 120;
  if ("wheelDeltaX" in ev) sX = -(ev.wheelDeltaX as number) / 120;

  if (
    "axis" in ev &&
    ev.axis === (ev as Record<string, unknown>).HORIZONTAL_AXIS
  ) {
    sX = sY;
    sY = 0;
  }

  let pX = sX * PIXEL_STEP;
  let pY = sY * PIXEL_STEP;

  if ("deltaY" in event) pY = event.deltaY;
  if ("deltaX" in event) pX = event.deltaX;

  if ((pX || pY) && event.deltaMode) {
    if (event.deltaMode === 1) {
      pX *= LINE_HEIGHT;
      pY *= LINE_HEIGHT;
    } else {
      pX *= PAGE_HEIGHT;
      pY *= PAGE_HEIGHT;
    }
  }

  if (pX && !sX) sX = pX < 1 ? -1 : 1;
  if (pY && !sY) sY = pY < 1 ? -1 : 1;

  return {
    spinX: sX,
    spinY: sY,
    pixelX: pX,
    pixelY: pY,
    deltaMode: event.deltaMode || 0,
  };
}

export function getConnectionInfo(): Record<string, string | number> {
  const nav = navigator as unknown as Record<string, unknown>;
  if (!("connection" in nav)) return {};
  const c = nav.connection as Record<string, unknown>;
  const info: Record<string, string | number> = {};

  if (c.type) info["type"] = c.type as string;
  if ("effectiveType" in c) info["effective-type"] = c.effectiveType as string;

  const dl = c.downlink as number;
  if (!isNaN(dl) && dl > 0 && isFinite(dl)) {
    info["downlink"] = Math.round(dl * 1_000_000);
  }

  const dlMax = c.downlinkMax as number;
  if (
    "downlinkMax" in c &&
    !isNaN(dlMax) &&
    dlMax > 0 &&
    isFinite(dlMax)
  ) {
    info["downlink.max"] = Math.round(dlMax * 1_000_000);
  }

  const rtt = c.rtt as number;
  if (!isNaN(rtt) && rtt > 0) info["rtt"] = rtt;

  return info;
}

export function saveFile(
  filename: string,
  data: BlobPart,
  mimetype: BlobPropertyBag,
): void {
  const a = document.createElement("a");
  a.setAttribute("style", "display: none");
  document.body.append(a);
  const blob = new Blob([data], mimetype);
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
