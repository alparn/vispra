/*
 * Author: Ali Parnan
 */

/**
 * Display capabilities: DPI, screen sizes, monitors.
 * Ported from Client.js _get_DPI, _get_screen_sizes, _get_monitors, _get_monitor, _get_display_caps.
 */

import { getOS, getBrowserName } from "@/core/utils/platform";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Monitor geometry: [x, y, width, height] */
export type MonitorGeometry = [number, number, number, number];

/** Workarea: [x, y, width, height] */
export type Workarea = [number, number, number, number];

/** Single monitor info for display caps */
export interface MonitorInfo {
  geometry: MonitorGeometry;
  primary: boolean;
  "refresh-rate": number;
  "width-mm": number;
  "height-mm": number;
  manufacturer: string;
  model: string;
  workarea: Workarea;
  name: string;
}

/** Screen size tuple: [name, w, h, wmm, hmm, [monitor], ...] */
export type ScreenSize = [
  string,
  number,
  number,
  number,
  number,
  [string, number, number, number, number, number, number][],
  number,
  number,
  number,
  number,
];

/** Display capabilities sent in hello */
export interface DisplayCaps {
  "refresh-rate": number;
  desktop_size: [number, number];
  desktop_mode_size: [number, number];
  screen_sizes: ScreenSize[];
  monitors: Map<number, MonitorInfo>;
}

// ---------------------------------------------------------------------------
// DPI
// ---------------------------------------------------------------------------

/**
 * Get display DPI. Uses #dpi element if present and has dimensions,
 * otherwise screen.systemXDPI/systemYDPI if available, else 96.
 */
export function getDPI(dpiElementId = "dpi"): number {
  if (typeof document === "undefined") return 96;

  const dpiDiv = document.querySelector(`#${dpiElementId}`);
  if (dpiDiv && dpiDiv instanceof HTMLElement && dpiDiv.offsetWidth > 0 && dpiDiv.offsetHeight > 0) {
    return Math.round((dpiDiv.offsetWidth + dpiDiv.offsetHeight) / 2);
  }

  const scr = screen as unknown as { systemXDPI?: number; systemYDPI?: number };
  const x = scr.systemXDPI;
  const y = scr.systemYDPI;
  if (x != null && y != null) {
    return Math.round((x + y) / 2);
  }

  return 96;
}

// ---------------------------------------------------------------------------
// Screen sizes
// ---------------------------------------------------------------------------

/**
 * Get screen sizes for hello packet.
 * Returns array of [name, width, height, width_mm, height_mm, [monitor], 0, 0, width, height].
 */
export function getScreenSizes(
  width: number,
  height: number,
  dpi: number,
): ScreenSize[] {
  const wmm = Math.round((width * 25.4) / dpi);
  const hmm = Math.round((height * 25.4) / dpi);
  const monitor: [string, number, number, number, number, number, number] = [
    "Canvas",
    0,
    0,
    width,
    height,
    wmm,
    hmm,
  ];

  let name = "HTML";
  const ua = navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string; version: string }> } };
  if (ua.userAgentData?.brands) {
    for (const brandInfo of ua.userAgentData.brands) {
      const brand = brandInfo.brand;
      if (brand && !brand.startsWith("Not") && !brand.endsWith("Brand")) {
        name = `${brand} ${brandInfo.version}`;
        break;
      }
    }
  }

  const screen: ScreenSize = [
    name,
    width,
    height,
    wmm,
    hmm,
    [monitor],
    0,
    0,
    width,
    height,
  ];
  return [screen];
}

// ---------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------

/**
 * Get single monitor info for the virtual "Canvas" display.
 */
export function getMonitor(
  desktopWidth: number,
  desktopHeight: number,
  dpi: number,
  vrefresh: number,
): MonitorInfo {
  const wmm = Math.round((desktopWidth * 25.4) / dpi);
  const hmm = Math.round((desktopHeight * 25.4) / dpi);
  return {
    geometry: [0, 0, desktopWidth, desktopHeight],
    primary: true,
    "refresh-rate": vrefresh,
    "width-mm": wmm,
    "height-mm": hmm,
    manufacturer: getOS(),
    model: getBrowserName(),
    workarea: [0, 0, desktopWidth, desktopHeight],
    name: "Canvas",
  };
}

/**
 * Get monitors map (single monitor at index 0).
 */
export function getMonitors(
  desktopWidth: number,
  desktopHeight: number,
  dpi: number,
  vrefresh: number,
): Map<number, MonitorInfo> {
  const monitors = new Map<number, MonitorInfo>();
  monitors.set(0, getMonitor(desktopWidth, desktopHeight, dpi, vrefresh));
  return monitors;
}

// ---------------------------------------------------------------------------
// Display caps
// ---------------------------------------------------------------------------

/**
 * Build display capabilities for hello packet.
 */
export function getDisplayCaps(
  desktopWidth: number,
  desktopHeight: number,
  vrefresh: number,
  dpiElementId?: string,
): DisplayCaps {
  const dpi = getDPI(dpiElementId);
  return {
    "refresh-rate": vrefresh,
    desktop_size: [desktopWidth, desktopHeight],
    desktop_mode_size: [desktopWidth, desktopHeight],
    screen_sizes: getScreenSizes(desktopWidth, desktopHeight, dpi),
    monitors: getMonitors(desktopWidth, desktopHeight, dpi, vrefresh),
  };
}
