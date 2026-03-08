/*
 * Author: Ali Parnan
 */

import { describe, it, expect, vi } from "vitest";
import { KeyboardController } from "../keyboard";

function createMockOptions() {
  const send = vi.fn();
  return {
    send,
    getFocusedWid: () => 1,
    getServerReadonly: () => false,
    swapKeys: false,
    keyboardLayout: null,
    clipboardEnabled: false,
    getClipboardDirection: () => "to-server",
    getClipboardDelayedEventTime: () => 0,
    setClipboardDelayedEventTime: vi.fn(),
  };
}

describe("KeyboardController", () => {
  describe("state machine", () => {
    it("starts in disabled state", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      expect(kb.getState()).toBe("disabled");
      expect(kb.getCaptureKeyboard()).toBe(false);
      kb.destroy();
    });

    it("enable() transitions to active", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      kb.enable();
      expect(kb.getState()).toBe("active");
      expect(kb.getCaptureKeyboard()).toBe(true);
      kb.destroy();
    });

    it("disable() transitions to disabled", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      kb.enable();
      kb.disable();
      expect(kb.getState()).toBe("disabled");
      expect(kb.getCaptureKeyboard()).toBe(false);
      kb.destroy();
    });

    it("setLocked(true) transitions active->locked", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      kb.enable();
      kb.setLocked(true);
      expect(kb.getState()).toBe("locked");
      expect(kb.getCaptureKeyboard()).toBe(true);
      kb.destroy();
    });

    it("setLocked(false) transitions locked->active", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      kb.enable();
      kb.setLocked(true);
      kb.setLocked(false);
      expect(kb.getState()).toBe("active");
      kb.destroy();
    });

    it("destroy() clears state and aborts", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      kb.enable();
      kb.destroy();
      expect(kb.getState()).toBe("disabled");
    });
  });

  describe("getModifiers / translateModifiers", () => {
    it("translates modifiers correctly", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      const event = {
        getModifierState: (key: string) => key === "Shift",
      };
      const mods = kb.getModifiers(event);
      expect(mods).toContain("shift");
      kb.destroy();
    });

    it("swapKeys swaps Control and Meta", () => {
      const opts = createMockOptions();
      opts.swapKeys = true;
      const kb = new KeyboardController(opts);
      const event = {
        getModifierState: (key: string) => key === "Meta",
      };
      const mods = kb.getModifiers(event);
      expect(mods).toContain("control");
      kb.destroy();
    });
  });

  describe("getKeycodes", () => {
    it("returns keycode tuples", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      const keycodes = kb.getKeycodes();
      expect(Array.isArray(keycodes)).toBe(true);
      expect(keycodes.length).toBeGreaterThan(0);
      const [kc, name, kc2, group, level] = keycodes[0];
      expect(typeof kc).toBe("number");
      expect(typeof name).toBe("string");
      expect(kc).toBe(kc2);
      expect(group).toBe(0);
      expect(level).toBe(0);
      kb.destroy();
    });
  });

  describe("processKeyEvent", () => {
    it("returns true when server readonly", () => {
      const opts = createMockOptions();
      opts.getServerReadonly = () => true;
      const kb = new KeyboardController(opts);
      kb.enable();
      const ev = new KeyboardEvent("keydown", { key: "a", code: "KeyA" });
      const r = kb.processKeyEvent(true, ev);
      expect(r).toBe(true);
      expect(opts.send).not.toHaveBeenCalled();
      kb.destroy();
    });

    it("returns true when capture disabled", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      expect(kb.getState()).toBe("disabled");
      const ev = new KeyboardEvent("keydown", { key: "a", code: "KeyA" });
      const r = kb.processKeyEvent(true, ev);
      expect(r).toBe(true);
      expect(opts.send).not.toHaveBeenCalled();
      kb.destroy();
    });

    it("sends key packet when active", () => {
      const opts = createMockOptions();
      const kb = new KeyboardController(opts);
      kb.enable();
      const ev = new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        keyCode: 65,
        which: 65,
      });
      vi.useFakeTimers();
      const r = kb.processKeyEvent(true, ev);
      vi.advanceTimersByTime(100);
      expect(r).toBe(false);
      expect(opts.send).toHaveBeenCalled();
      const packet = opts.send.mock.calls[0][0] as unknown[];
      expect(packet[0]).toBe("key-action");
      expect(packet[2]).toBe("a");
      expect(packet[3]).toBe(true);
      vi.useRealTimers();
      kb.destroy();
    });
  });
});
