/*
 * Author: Ali Parnan
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClipboardTokenPacket } from "@/core/protocol/types";
import { ClipboardManager, UTF8_STRING } from "../clipboard";
import { PACKET_TYPES } from "@/core/constants/packet-types";

function createMockClipboardOptions() {
  const onSend = vi.fn();
  return {
    enabled: true,
    poll: false,
    preferredFormat: "text/plain",
    targets: ["text/plain", "UTF8_STRING", "text/html"],
    pasteboard: "#pasteboard",
    onSend,
    isConnected: () => true,
    debug: vi.fn(),
    log: vi.fn(),
  };
}

describe("ClipboardManager", () => {
  let manager: ClipboardManager;
  let options: ReturnType<typeof createMockClipboardOptions>;

  beforeEach(() => {
    options = createMockClipboardOptions();
    manager = new ClipboardManager(options);
  });

  describe("getters", () => {
    it("returns empty buffer initially", () => {
      expect(manager.getBuffer()).toBe("");
      expect(manager.getDatatype()).toBeNull();
    });

    it("returns enabled state from options", () => {
      expect(manager.enabled).toBe(true);
      manager.enabled = false;
      expect(manager.enabled).toBe(false);
    });
  });

  describe("processClipboardToken", () => {
    it("ignores when disabled", () => {
      manager.enabled = false;
      const packet: ClipboardTokenPacket = [
        PACKET_TYPES.clipboard_token,
        "CLIPBOARD",
        ["text/plain"],
        "text/plain",
        "UTF8_STRING",
        8,
        "bytes",
        new TextEncoder().encode("hello"),
      ];
      manager.processClipboardToken(packet);
      expect(manager.getBuffer()).toBe("");
    });

    it("updates buffer for valid text target", () => {
      const packet = [
        PACKET_TYPES.clipboard_token,
        "CLIPBOARD",
        ["text/plain"],
        "text/plain",
        "UTF8_STRING",
        8,
        "bytes",
        "hello from server",
      ] as ClipboardTokenPacket;
      manager.processClipboardToken(packet);
      expect(manager.getBuffer()).toBe("hello from server");
      expect(manager.getDatatype()).toBe("UTF8_STRING");
    });

    it("ignores invalid target", () => {
      const packet: ClipboardTokenPacket = [
        PACKET_TYPES.clipboard_token,
        "CLIPBOARD",
        ["image/png"],
        "image/png",
        "image/png",
        8,
        "bytes",
        new Uint8Array([0x89, 0x50, 0x4e]),
      ];
      manager.processClipboardToken(packet);
      expect(manager.getBuffer()).toBe("");
    });

    it("stores server buffer for resend", () => {
      const packet: ClipboardTokenPacket = [
        PACKET_TYPES.clipboard_token,
        "CLIPBOARD",
        ["text/plain"],
        "text/plain",
        "UTF8_STRING",
        8,
        "bytes",
        new TextEncoder().encode("stored"),
      ];
      manager.processClipboardToken(packet);
      const buffers = manager.getServerBuffers();
      expect(buffers["CLIPBOARD"]).toBeDefined();
      expect(buffers["CLIPBOARD"][1]).toBe("UTF8_STRING");
    });
  });

  describe("processSetClipboardEnabled", () => {
    it("updates enabled state", () => {
      manager.processSetClipboardEnabled([
        PACKET_TYPES.set_clipboard_enabled,
        false,
        "user disabled",
      ]);
      expect(manager.enabled).toBe(false);
    });
  });

  describe("sendClipboardToken", () => {
    it("does not send when disabled", () => {
      manager.enabled = false;
      manager.sendClipboardToken(new TextEncoder().encode("test"));
      expect(options.onSend).not.toHaveBeenCalled();
    });

    it("does not send when not connected", () => {
      options.isConnected = () => false;
      manager.sendClipboardToken(new TextEncoder().encode("test"));
      expect(options.onSend).not.toHaveBeenCalled();
    });

    it("sends clipboard-token packet when connected", () => {
      const data = new TextEncoder().encode("hello");
      manager.sendClipboardToken(data);
      expect(options.onSend).toHaveBeenCalledTimes(1);
      const packet = options.onSend.mock.calls[0][0];
      expect(packet[0]).toBe(PACKET_TYPES.clipboard_token);
      expect(packet[1]).toBe("CLIPBOARD");
      expect(packet[7]).toBe(data);
      expect(packet[8]).toBe(true); // claim
      expect(packet[9]).toBe(true); // greedy
      expect(packet[10]).toBe(true); // synchronous
    });

    it("uses preferred format order when UTF8_STRING", () => {
      options.preferredFormat = UTF8_STRING;
      manager = new ClipboardManager(options);
      manager.sendClipboardToken(new TextEncoder().encode("x"));
      const packet = options.onSend.mock.calls[0][0];
      expect(packet[2]).toEqual([UTF8_STRING, "text/plain"]);
    });
  });

  describe("sendClipboardString / sendClipboardNone", () => {
    it("sendClipboardString sends clipboard-contents packet", () => {
      manager.sendClipboardString(42, "CLIPBOARD", "test content", UTF8_STRING);
      expect(options.onSend).toHaveBeenCalledTimes(1);
      const packet = options.onSend.mock.calls[0][0];
      expect(packet[0]).toBe(PACKET_TYPES.clipboard_contents);
      expect(packet[1]).toBe(42);
      expect(packet[2]).toBe("CLIPBOARD");
      expect(packet[3]).toBe(UTF8_STRING);
      expect(packet[6]).toBe("test content");
    });

    it("sendClipboardString with empty buffer sends clipboard-contents-none", () => {
      manager.sendClipboardString(1, "CLIPBOARD", "");
      expect(options.onSend).toHaveBeenCalledWith([
        PACKET_TYPES.clipboard_contents_none,
        1,
        "CLIPBOARD",
      ]);
    });

    it("sendClipboardContents with Uint8Array sends binary data", () => {
      const buf = new Uint8Array([1, 2, 3]);
      manager.sendClipboardContents(1, "CLIPBOARD", "image/png", 8, "bytes", buf);
      const packet = options.onSend.mock.calls[0][0];
      expect(packet[0]).toBe(PACKET_TYPES.clipboard_contents);
      expect(packet[6]).toBe(buf);
    });
  });

  describe("processClipboardRequest", () => {
    it("sends clipboard-contents-none for non-CLIPBOARD selection", () => {
      manager.processClipboardRequest([
        PACKET_TYPES.clipboard_request,
        99,
        "PRIMARY",
      ]);
      expect(options.onSend).toHaveBeenCalledWith([
        PACKET_TYPES.clipboard_contents_none,
        99,
        "PRIMARY",
      ]);
    });

    it("sends buffer when no navigator.clipboard (fallback)", () => {
      const origClipboard = globalThis.navigator.clipboard;
      (globalThis.navigator as { clipboard?: unknown }).clipboard = undefined;
      manager.processClipboardToken([
        PACKET_TYPES.clipboard_token,
        "CLIPBOARD",
        ["text/plain"],
        "text/plain",
        "UTF8_STRING",
        8,
        "bytes",
        "fallback content",
      ] as ClipboardTokenPacket);
      manager.processClipboardRequest([
        PACKET_TYPES.clipboard_request,
        1,
        "CLIPBOARD",
      ]);
      const sent = options.onSend.mock.calls[0][0];
      expect(sent[0]).toBe(PACKET_TYPES.clipboard_contents);
      expect(sent[1]).toBe(1);
      expect(sent[2]).toBe("CLIPBOARD");
      expect(sent[3]).toBe(UTF8_STRING);
      expect(sent[6]).toBe("fallback content");
      (globalThis.navigator as { clipboard?: unknown }).clipboard = origClipboard;
    });
  });

  describe("resendClipboardServerBuffer", () => {
    it("sends clipboard-contents-none when no server buffer", () => {
      manager.resendClipboardServerBuffer(1, "CLIPBOARD");
      expect(options.onSend).toHaveBeenCalledWith([
        PACKET_TYPES.clipboard_contents_none,
        1,
        "CLIPBOARD",
      ]);
    });

    it("resends stored server buffer when available", () => {
      const wireData = new TextEncoder().encode("resend me");
      manager.processClipboardToken([
        PACKET_TYPES.clipboard_token,
        "CLIPBOARD",
        ["text/plain"],
        "text/plain",
        "UTF8_STRING",
        8,
        "bytes",
        wireData,
      ] as ClipboardTokenPacket);
      options.onSend.mockClear();
      manager.resendClipboardServerBuffer(2, "CLIPBOARD");
      const sent = options.onSend.mock.calls[0][0];
      expect(sent[0]).toBe(PACKET_TYPES.clipboard_contents);
      expect(sent[1]).toBe(2);
      expect(sent[2]).toBe("CLIPBOARD");
      expect(sent[3]).toBe("UTF8_STRING");
      expect(sent[6]).toEqual(wireData);
    });
  });
});
