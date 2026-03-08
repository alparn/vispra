/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  METADATA_SUPPORTED,
  FILE_CHUNKS_SIZE,
  RGB_FORMATS,
  CLIENT_VERSION,
  getKeycodes,
  resolveKeyboardLayout,
  getEncodingCaps,
  getAudioCaps,
  getPointerCaps,
  getClipboardCaps,
  getKeymapCaps,
  getFileCaps,
  getDigests,
  getNetworkCaps,
  getBuildCaps,
  getPlatformCaps,
  updateCapabilities,
  makeHelloBase,
  makeHello,
  type CapabilitiesBuilderInput,
  type EncodingOptions,
} from "../builder";

const defaultEncodingOptions: EncodingOptions = {
  "": "auto",
  icons: { max_size: [30, 30], greedy: true },
  transparency: true,
  rgb_lz4: true,
  "decoder-speed": { video: 0 },
  "color-gamut": "srgb",
  video_scaling: true,
  video_max_size: [1024, 768],
  full_csc_modes: {
    jpeg: ["BGRX", "BGRA", "BGR", "RGBX", "RGBA", "RGB"],
  },
};

function makeInput(overrides: Partial<CapabilitiesBuilderInput> = {}): CapabilitiesBuilderInput {
  const container = document.createElement("div");
  container.style.width = "1920px";
  container.style.height = "1080px";
  document.body.appendChild(container);

  const input: CapabilitiesBuilderInput = {
    container,
    keyboardLayout: null,
    supportedEncodings: ["jpeg", "png", "rgb24", "rgb32", "scroll", "void"],
    encodingOptions: defaultEncodingOptions,
    audioCodecs: ["opus", "mp3"],
    clipboardEnabled: true,
    clipboardPoll: false,
    clipboardPreferredFormat: "text/plain",
    printing: false,
    openUrl: true,
    username: "testuser",
    uuid: "test-uuid-123",
    sharing: false,
    steal: true,
    vrefresh: -1,
    bandwidthLimit: 0,
    startNewSession: null,
    encryption: false,
    ...overrides,
  };
  return input;
}

describe("capabilities builder", () => {
  describe("constants", () => {
    it("exports METADATA_SUPPORTED with expected keys", () => {
      expect(METADATA_SUPPORTED).toContain("fullscreen");
      expect(METADATA_SUPPORTED).toContain("title");
    });

    it("FILE_CHUNKS_SIZE is 128KB", () => {
      expect(FILE_CHUNKS_SIZE).toBe(128 * 1024);
    });

    it("RGB_FORMATS includes RGBX, RGBA, RGB", () => {
      expect(RGB_FORMATS).toContain("RGBX");
      expect(RGB_FORMATS).toContain("RGBA");
      expect(RGB_FORMATS).toContain("RGB");
    });

    it("CLIENT_VERSION is set", () => {
      expect(CLIENT_VERSION).toBeTruthy();
    });
  });

  describe("getKeycodes", () => {
    it("returns array of [keyval, name, keycode, group, level]", () => {
      const kc = getKeycodes();
      expect(Array.isArray(kc)).toBe(true);
      expect(kc.length).toBeGreaterThan(0);
      const first = kc[0];
      expect(first).toHaveLength(5);
      expect(typeof first[0]).toBe("number");
      expect(typeof first[1]).toBe("string");
    });
  });

  describe("resolveKeyboardLayout", () => {
    it("returns override when provided", () => {
      expect(resolveKeyboardLayout("de")).toBe("de");
    });

    it("returns detected layout when override is null", () => {
      const layout = resolveKeyboardLayout(null);
      expect(typeof layout).toBe("string");
      expect(layout.length).toBeGreaterThan(0);
    });
  });

  describe("getEncodingCaps", () => {
    it("returns encoding options as object", () => {
      const caps = getEncodingCaps(defaultEncodingOptions);
      expect(caps[""]).toBe("auto");
      expect(caps.icons).toEqual({ max_size: [30, 30], greedy: true });
    });
  });

  describe("getAudioCaps", () => {
    it("returns receive, send, decoders", () => {
      const caps = getAudioCaps(["opus", "mp3"]);
      expect(caps.receive).toBe(true);
      expect(caps.send).toBe(true);
      expect(caps.decoders).toEqual(["opus", "mp3"]);
    });
  });

  describe("getPointerCaps", () => {
    it("returns double_click object", () => {
      const caps = getPointerCaps();
      expect(caps).toEqual({ double_click: {} });
    });
  });

  describe("getClipboardCaps", () => {
    it("returns enabled, selections, preferred-targets", () => {
      const caps = getClipboardCaps(true, false, "text/plain");
      expect(caps.enabled).toBe(true);
      expect(caps.want_targets).toBe(true);
      expect(caps.greedy).toBe(true);
      expect(Array.isArray(caps.selections)).toBe(true);
      expect(Array.isArray(caps["preferred-targets"])).toBe(true);
    });
  });

  describe("getKeymapCaps", () => {
    it("returns layout and keycodes", () => {
      const keycodes = getKeycodes();
      const caps = getKeymapCaps("us", keycodes);
      expect(caps.layout).toBe("us");
      expect(caps.keycodes).toBe(keycodes);
    });
  });

  describe("getFileCaps", () => {
    it("returns enabled, printing, open-url, size-limit", () => {
      const caps = getFileCaps(false, true);
      expect(caps.enabled).toBe(true);
      expect(caps.printing).toBe(false);
      expect(caps["open-url"]).toBe(true);
      expect(caps["size-limit"]).toBe(32 * 1024 * 1024);
    });
  });

  describe("getDigests", () => {
    it("includes xor and hmac variants", () => {
      const digests = getDigests();
      expect(digests).toContain("xor");
      expect(digests).toContain("keycloak");
      expect(digests).toContain("hmac+sha256");
    });
  });

  describe("getNetworkCaps", () => {
    it("returns digest, connection-data, brotli, lz4", () => {
      const caps = getNetworkCaps(0);
      expect(Array.isArray(caps.digest)).toBe(true);
      expect(typeof caps.rencodeplus).toBe("boolean");
      expect(typeof caps.brotli).toBe("boolean");
      expect(typeof caps.lz4).toBe("boolean");
      expect(caps["bandwidth-limit"]).toBe(0);
    });
  });

  describe("getBuildCaps", () => {
    it("returns revision, local_modifications, branch", () => {
      const caps = getBuildCaps();
      expect(typeof caps.revision).toBe("number");
      expect(typeof caps.local_modifications).toBe("number");
      expect(typeof caps.branch).toBe("string");
    });
  });

  describe("getPlatformCaps", () => {
    it("returns platform name and processor", () => {
      const caps = getPlatformCaps();
      expect(typeof caps[""]).toBe("string");
      expect(typeof caps.name).toBe("string");
      expect(typeof caps.processor).toBe("string");
      expect(typeof caps.platform).toBe("string");
    });
  });

  describe("updateCapabilities", () => {
    it("merges append into base", () => {
      const base: Record<string, unknown> = { a: 1 };
      updateCapabilities(base as import("@/core/protocol/types").Capabilities, { b: 2, c: 3 });
      expect(base).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe("makeHelloBase", () => {
    it("returns base hello with version, display, build, platform", () => {
      const input = makeInput();
      try {
        const caps = makeHelloBase(input);
        expect(caps.version).toBe(CLIENT_VERSION);
        expect(caps.client_type).toBe("HTML5");
        expect(caps.display).toBeDefined();
        expect(caps.build).toBeDefined();
        expect(caps.platform).toBeDefined();
        expect(caps.username).toBe("testuser");
        expect(caps.uuid).toBe("test-uuid-123");
        expect(caps.steal).toBe(true);
      } finally {
        document.body.removeChild(input.container);
      }
    });
  });

  describe("makeHello", () => {
    it("returns full hello with encodings, keymap, clipboard, screen_sizes, dpi", () => {
      const input = makeInput();
      try {
        const caps = makeHello(input);
        expect(caps.version).toBe(CLIENT_VERSION);
        expect(caps.encodings).toBeDefined();
        expect((caps.encodings as Record<string, unknown>).core).toEqual(input.supportedEncodings);
        expect(caps.keymap).toBeDefined();
        expect(caps.clipboard).toBeDefined();
        expect(caps.screen_sizes).toBeDefined();
        expect(Array.isArray(caps.screen_sizes)).toBe(true);
        expect(caps.dpi).toEqual({ x: expect.any(Number), y: expect.any(Number) });
        expect(caps.windows).toBe(true);
        expect(caps.keyboard).toBe(true);
      } finally {
        document.body.removeChild(input.container);
      }
    });
  });
});
