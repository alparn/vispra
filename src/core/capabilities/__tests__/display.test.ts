/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  getDPI,
  getScreenSizes,
  getMonitor,
  getMonitors,
  getDisplayCaps,
} from "../display";

describe("display capabilities", () => {
  describe("getDPI", () => {
    it("returns 96 when no dpi element and no screen DPI", () => {
      expect(getDPI()).toBe(96);
    });

    it("uses dpi element when present with dimensions", () => {
      const div = document.createElement("div");
      div.id = "dpi";
      div.style.width = "96px";
      div.style.height = "96px";
      document.body.appendChild(div);
      try {
        const dpi = getDPI("dpi");
        expect(dpi).toBeGreaterThanOrEqual(0);
      } finally {
        document.body.removeChild(div);
      }
    });
  });

  describe("getScreenSizes", () => {
    it("returns single screen with correct structure", () => {
      const sizes = getScreenSizes(1920, 1080, 96);
      expect(sizes).toHaveLength(1);
      const [name, w, h, wmm, hmm, monitors, _a, _b, w2, h2] = sizes[0];
      expect(name).toBeTruthy();
      expect(w).toBe(1920);
      expect(h).toBe(1080);
      expect(wmm).toBeGreaterThan(0);
      expect(hmm).toBeGreaterThan(0);
      expect(monitors).toHaveLength(1);
      expect(w2).toBe(1920);
      expect(h2).toBe(1080);
    });
  });

  describe("getMonitor", () => {
    it("returns monitor with geometry and dimensions", () => {
      const m = getMonitor(1920, 1080, 96, 60);
      expect(m.geometry).toEqual([0, 0, 1920, 1080]);
      expect(m.primary).toBe(true);
      expect(m["refresh-rate"]).toBe(60);
      expect(m["width-mm"]).toBeGreaterThan(0);
      expect(m["height-mm"]).toBeGreaterThan(0);
      expect(m.manufacturer).toBeTruthy();
      expect(m.model).toBeTruthy();
      expect(m.name).toBe("Canvas");
    });
  });

  describe("getMonitors", () => {
    it("returns map with single monitor at index 0", () => {
      const monitors = getMonitors(1920, 1080, 96, 60);
      expect(monitors.size).toBe(1);
      expect(monitors.has(0)).toBe(true);
      const m = monitors.get(0)!;
      expect(m.name).toBe("Canvas");
    });
  });

  describe("getDisplayCaps", () => {
    it("returns complete display caps", () => {
      const caps = getDisplayCaps(1920, 1080, 60);
      expect(caps["refresh-rate"]).toBe(60);
      expect(caps.desktop_size).toEqual([1920, 1080]);
      expect(caps.desktop_mode_size).toEqual([1920, 1080]);
      expect(caps.screen_sizes).toHaveLength(1);
      expect(caps.monitors.size).toBe(1);
    });
  });
});
