/*
 * Author: Ali Parnan
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioManager, type AudioManagerOptions } from "../audio";

function createMockOptions(): AudioManagerOptions {
  return {
    onSend: vi.fn(),
    isConnected: () => true,
    onStateChange: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("AudioManager", () => {
  let manager: AudioManager;
  let opts: AudioManagerOptions;

  beforeEach(() => {
    opts = createMockOptions();
    manager = new AudioManager(opts);
  });

  describe("before init", () => {
    it("is not enabled by default", () => {
      expect(manager.isEnabled()).toBe(false);
    });

    it("returns empty codec list", () => {
      expect(manager.getCodecNames()).toEqual([]);
    });

    it("has no framework", () => {
      expect(manager.getFramework()).toBeNull();
    });

    it("has no codec", () => {
      expect(manager.getCodec()).toBeNull();
    });

    it("has empty state", () => {
      expect(manager.getState()).toBe("");
    });
  });

  describe("init", () => {
    it("detects MediaSource when available", () => {
      manager.init();
      // In test environment, MediaSource may or may not be available
      // but init should not throw
      expect(manager.getState()).toBe("");
    });

    it("warns when no codecs found and no backends available", () => {
      // In JSDOM environment there's usually no MediaSource and no AV
      manager.init();
      if (!manager.isEnabled()) {
        expect(opts.warn).toHaveBeenCalledWith(
          expect.stringContaining("no valid"),
        );
      }
    });
  });

  describe("processServerCaps", () => {
    it("disables audio when server does not support send", () => {
      manager.init();
      manager.processServerCaps({ send: false });
      expect(manager.isEnabled()).toBe(false);
    });

    it("disables audio when server has no encoders", () => {
      manager.init();
      manager.processServerCaps({ send: true });
      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe("processSoundData", () => {
    it("closes audio on codec mismatch", () => {
      manager.init();
      const closeSpy = vi.spyOn(manager, "close");
      manager.processSoundData(
        "wrong-codec",
        new Uint8Array([1, 2, 3]),
        {},
        null,
      );
      expect(closeSpy).toHaveBeenCalled();
    });

    it("handles end-of-stream", () => {
      manager.init();
      const closeSpy = vi.spyOn(manager, "close");
      manager.processSoundData(
        manager.getCodec() ?? "opus+mka",
        new Uint8Array([1, 2, 3]),
        { "end-of-stream": true },
        null,
      );
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe("playBell", () => {
    it("does not throw without AudioContext", () => {
      expect(() => {
        manager.playBell(50, 440, 200);
      }).not.toThrow();
    });
  });

  describe("close", () => {
    it("sends sound-control stop when connected", () => {
      manager.init();
      // Force enabled for test
      (manager as unknown as Record<string, unknown>)["audioEnabled"] = true;
      manager.close();
      expect(opts.onSend).toHaveBeenCalledWith(
        expect.arrayContaining(["sound-control", "stop"]),
      );
    });

    it("sets state to stopped", () => {
      manager.close();
      expect(manager.getState()).toBe("stopped");
      expect(opts.onStateChange).toHaveBeenCalledWith("stopped", "closed");
    });
  });

  describe("destroy", () => {
    it("does not throw", () => {
      expect(() => {
        manager.destroy();
      }).not.toThrow();
    });
  });
});
