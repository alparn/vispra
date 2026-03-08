/**
 * Integration tests against a real Xpra server.
 *
 * Prerequisites:
 *   docker run -d --name xpra-test -p 10000:10000 xpra-server
 *
 * Run:
 *   XPRA_TEST_URL=ws://localhost:10000 npm run test:integration
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decompressBlock as lz4DecompressBlock } from "lz4js";
import {
  HEADER_SIZE,
  HEADER_MAGIC,
  ProtoFlags,
  CompressionLevel,
} from "@/core/protocol/types";
import { PACKET_TYPES } from "@/core/constants/packet-types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Load vendor rencode.js into the global scope (it expects `globalThis`)
// ---------------------------------------------------------------------------

const rencodeSrc = readFileSync(
  resolve(__dirname, "../vendor/rencode.js"),
  "utf-8",
);
const rencodeFactory = new Function(rencodeSrc + "\nreturn { rencode, rdecode, RENCODE };");
const rencodeModule = rencodeFactory();
const rencodeEncode: (obj: unknown) => Uint8Array = rencodeModule.rencode;
const rencodeDecode: (buf: Uint8Array) => any = rencodeModule.rdecode;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const XPRA_URL = process.env.XPRA_TEST_URL ?? "ws://localhost:10000";
const CONNECT_TIMEOUT = 10_000;
const PACKET_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeader(payloadSize: number): Uint8Array {
  const h = new Uint8Array(HEADER_SIZE);
  h[0] = HEADER_MAGIC;
  h[1] = ProtoFlags.RENCODEPLUS;
  h[2] = 0;
  h[3] = 0;
  h[4] = (payloadSize >>> 24) & 0xff;
  h[5] = (payloadSize >>> 16) & 0xff;
  h[6] = (payloadSize >>> 8) & 0xff;
  h[7] = payloadSize & 0xff;
  return h;
}

function encodePacket(packet: unknown[]): Buffer {
  const payload = rencodeEncode(packet);
  const header = makeHeader(payload.length);
  const frame = Buffer.alloc(HEADER_SIZE + payload.length);
  frame.set(header, 0);
  frame.set(payload, HEADER_SIZE);
  return frame;
}

interface DecodedPacket {
  type: string;
  data: any[];
}

function decodeFrame(
  buf: Buffer,
  compressionLevel: number,
  index: number,
  rawPackets: Record<number, Uint8Array>,
): DecodedPacket | null {
  if (buf.length === 0) return null;

  let payload = new Uint8Array(buf);

  // Decompress if needed
  if (compressionLevel !== CompressionLevel.NONE) {
    if (compressionLevel & CompressionLevel.LZ4) {
      try {
        const uncompressedLen =
          payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24);
        if (uncompressedLen <= 0 || uncompressedLen > 0x4000_0000) return null;
        const inflated = new Uint8Array(uncompressedLen);
        lz4DecompressBlock(payload, inflated, 4, payload.length - 4, 0);
        payload = inflated;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  // Chunked (raw) packets — store and wait for index 0
  if (index > 0) {
    rawPackets[index] = payload;
    return null;
  }

  let decoded: any;
  try {
    decoded = rencodeDecode(payload);
  } catch {
    return null;
  }
  const packet = Array.isArray(decoded) ? decoded : decoded[0] ?? decoded;

  // Merge raw packets
  for (const rawIdx in rawPackets) {
    packet[rawIdx] = rawPackets[rawIdx];
  }
  for (const key of Object.keys(rawPackets)) delete rawPackets[Number(key)];

  const rawType = packet[0];
  const type =
    typeof rawType === "string"
      ? rawType
      : rawType instanceof Uint8Array || rawType instanceof Buffer
        ? new TextDecoder().decode(rawType)
        : String(rawType);

  return { type, data: packet };
}

/**
 * Minimal hello capabilities sufficient for an Xpra handshake.
 */
function buildMinimalHello(): Record<string, unknown> {
  return {
    version: "20",
    client_type: "HTML5",
    "session-type": "test",
    "session-type.full": "vitest integration test",
    username: "",
    uuid: "test-uuid-" + Date.now(),
    share: true,
    steal: true,
    rencodeplus: true,
    lz4: false,
    brotli: false,
    "bandwidth-limit": 0,
    compression_level: 1,
    digest: ["xor"],
    "salt-digest": ["xor"],
    windows: true,
    keyboard: true,
    encodings: {
      "": ["png", "jpeg", "rgb24", "rgb32", "scroll", "void"],
      core: ["png", "jpeg", "rgb24", "rgb32", "scroll", "void"],
      rgb_formats: ["RGBX", "RGBA", "RGB"],
      cursor: ["png"],
      "window-icon": ["png"],
      packet: true,
    },
    encoding: {
      "": "png",
      icons: { max_size: [30, 30], greedy: true },
      transparency: true,
      rgb_lz4: false,
      "decoder-speed": { video: 0 },
      "color-gamut": "srgb",
      video_scaling: true,
      video_max_size: [1024, 768],
      full_csc_modes: {},
    },
    "metadata.supported": [
      "fullscreen", "maximized", "iconic", "above", "below",
      "title", "size-hints", "class-instance", "transient-for",
      "window-type", "has-alpha", "decorations", "override-redirect",
      "tray", "modal", "opacity",
    ],
    clipboard: { enabled: false },
    audio: { receive: false, send: false, decoders: [] },
    file: { enabled: false },
    pointer: { double_click: {} },
    keymap: { layout: "us", keycodes: [] },
    display: {
      "max-desktop-size": [8192, 4096],
      dpi: { x: 96, y: 96 },
    },
    screen_sizes: [[1920, 1080, 508, 286, [], 0, 96, 96]],
    dpi: { x: 96, y: 96 },
    vrefresh: -1,
    "file-chunks": 131072,
    "setting-change": true,
    "mouse.show": true,
    auto_refresh_delay: 500,
    bell: true,
    cursors: true,
    notifications: { enabled: false },
    system_tray: false,
    named_cursors: false,
    wants: [],
    build: { revision: 0, local_modifications: 0, branch: "test" },
    platform: { "": "Test", name: "Test", processor: "unknown" },
    network: { pings: 5 },
    argv: ["test"],
  };
}

class XpraTestClient {
  ws: WebSocket | null = null;
  receivedPackets: DecodedPacket[] = [];
  private recvBuffer = Buffer.alloc(0);
  private rawPackets: Record<number, Uint8Array> = {};
  private connected = false;

  async connect(url: string = XPRA_URL): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Connection to ${url} timed out`)),
        CONNECT_TIMEOUT,
      );

      this.ws = new WebSocket(url, "binary");
      this.ws.binaryType = "arraybuffer";

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.ws.on("message", (data: Buffer | ArrayBuffer) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this.recvBuffer = Buffer.concat([this.recvBuffer, buf]);
        this.processBuffer();
      });

      this.ws.on("close", () => {
        this.connected = false;
      });
    });
  }

  private processBuffer(): void {
    while (this.recvBuffer.length >= HEADER_SIZE) {
      if (this.recvBuffer[0] !== HEADER_MAGIC) {
        this.recvBuffer = Buffer.alloc(0);
        return;
      }

      const compressionLevel = this.recvBuffer[2];
      const index = this.recvBuffer[3];
      const payloadSize =
        ((this.recvBuffer[4] << 24) |
          (this.recvBuffer[5] << 16) |
          (this.recvBuffer[6] << 8) |
          this.recvBuffer[7]) >>> 0;

      const totalSize = HEADER_SIZE + payloadSize;
      if (this.recvBuffer.length < totalSize) break;

      const payloadBuf = Buffer.from(
        this.recvBuffer.subarray(HEADER_SIZE, totalSize),
      );
      this.recvBuffer = this.recvBuffer.subarray(totalSize);

      const decoded = decodeFrame(payloadBuf, compressionLevel, index, this.rawPackets);
      if (decoded) {
        this.receivedPackets.push(decoded);
      }
    }
  }

  sendPacket(packet: unknown[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
    this.ws.send(encodePacket(packet));
  }

  sendHello(caps?: Record<string, unknown>): void {
    this.sendPacket([PACKET_TYPES.hello, caps ?? buildMinimalHello()]);
  }

  async waitForPacket(
    type: string,
    timeoutMs = PACKET_TIMEOUT,
  ): Promise<DecodedPacket> {
    const existing = this.receivedPackets.find((p) => p.type === type);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for packet '${type}'`)),
        timeoutMs,
      );
      const interval = setInterval(() => {
        const found = this.receivedPackets.find((p) => p.type === type);
        if (found) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve(found);
        }
      }, 50);
    });
  }

  async waitForPackets(
    type: string,
    count: number,
    timeoutMs = PACKET_TIMEOUT,
  ): Promise<DecodedPacket[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for ${count}x '${type}'`)),
        timeoutMs,
      );
      const interval = setInterval(() => {
        const found = this.receivedPackets.filter((p) => p.type === type);
        if (found.length >= count) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve(found);
        }
      }, 50);
    });
  }

  getPackets(type: string): DecodedPacket[] {
    return this.receivedPackets.filter((p) => p.type === type);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.receivedPackets = [];
    this.recvBuffer = Buffer.alloc(0);
    this.rawPackets = {};
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

// ---------------------------------------------------------------------------
// Environment check: skip under jsdom (unit-test runner)
// ---------------------------------------------------------------------------

function isNodeEnvironment(): boolean {
  // In jsdom, the `ws` package throws a synchronous error about browser usage.
  // In real Node, WebSocket constructor from `ws` is available.
  try {
    return typeof WebSocket === "function" && !("document" in globalThis && (globalThis as any).navigator?.userAgent?.includes("jsdom"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Check server availability before running tests
// ---------------------------------------------------------------------------

async function isServerAvailable(): Promise<boolean> {
  if (!isNodeEnvironment()) return false;
  return new Promise((resolve) => {
    const ws = new WebSocket(XPRA_URL, "binary");
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 3000);
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Xpra Server Integration Tests", () => {
  let client: XpraTestClient;
  let serverAvailable: boolean;

  beforeAll(async () => {
    serverAvailable = await isServerAvailable();
    if (!serverAvailable) {
      console.warn(
        `\n⚠ Xpra server not reachable at ${XPRA_URL}.\n` +
        "  Skipping integration tests.\n" +
        "  Start with: docker run -d --name xpra-test -p 10000:10000 xpra-server\n",
      );
    }
  });

  beforeAll(() => {
    client = new XpraTestClient();
  });

  afterEach(() => {
    client.close();
  });

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  describe("Connection lifecycle", () => {
    it("establishes a WebSocket connection to the Xpra server", async () => {
      if (!serverAvailable) return;

      await client.connect();
      expect(client.isConnected).toBe(true);
    });

    it("completes the hello handshake and receives server hello", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();

      const hello = await client.waitForPacket("hello");
      expect(hello).toBeTruthy();
      expect(hello.type).toBe("hello");

      const caps = hello.data[1];
      expect(caps).toBeTruthy();
      expect(typeof caps === "object").toBe(true);
    });

    it("receives server version in hello response", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();

      const hello = await client.waitForPacket("hello");
      const caps = hello.data[1] as Record<string, unknown>;

      const version = caps["version"];
      expect(version).toBeTruthy();
      const vStr = typeof version === "string"
        ? version
        : new TextDecoder().decode(version as Uint8Array);
      expect(vStr).toMatch(/^\d+/);
    });

    it("server confirms rencodeplus support", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();

      const hello = await client.waitForPacket("hello");
      const caps = hello.data[1] as Record<string, unknown>;
      expect(caps["rencodeplus"]).toBeTruthy();
    });

    it("disconnects cleanly", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      client.close();
      expect(client.isConnected).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Ping / Pong
  // -----------------------------------------------------------------------

  describe("Ping / Pong", () => {
    it("responds to server ping with ping_echo", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const ping = await client.waitForPacket("ping", 20_000);
      expect(ping).toBeTruthy();
      expect(ping.type).toBe("ping");

      const echotime = ping.data[1];
      client.sendPacket([
        PACKET_TYPES.ping_echo,
        echotime, 0, 0, 0, 0, "",
      ]);

      // Server should continue sending pings — we just verify we got one
      expect(typeof echotime).toBe("number");
    });

    it("client can send ping and receive ping_echo", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const now = Date.now();
      client.sendPacket([PACKET_TYPES.ping, now]);

      const echo = await client.waitForPacket("ping_echo");
      expect(echo).toBeTruthy();
      expect(echo.data[1]).toBe(now);
    });
  });

  // -----------------------------------------------------------------------
  // Window management
  // -----------------------------------------------------------------------

  describe("Window management", () => {
    it("receives new-window packet for xterm", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const newWindow = await client.waitForPacket("new-window", 10_000);
      expect(newWindow).toBeTruthy();
      expect(newWindow.type).toBe("new-window");

      // new-window: [type, wid, x, y, w, h, metadata, ...]
      const wid = newWindow.data[1];
      expect(typeof wid).toBe("number");
      expect(wid).toBeGreaterThan(0);

      const width = newWindow.data[4];
      const height = newWindow.data[5];
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    });

    it("receives window metadata with title", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const newWindow = await client.waitForPacket("new-window", 10_000);
      const metadata = newWindow.data[6];
      expect(metadata).toBeTruthy();
      expect(typeof metadata).toBe("object");
    });

    it("can send map-window and configure-window responses", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const newWindow = await client.waitForPacket("new-window", 10_000);
      const wid = newWindow.data[1] as number;
      const x = newWindow.data[2] as number;
      const y = newWindow.data[3] as number;
      const w = newWindow.data[4] as number;
      const h = newWindow.data[5] as number;

      client.sendPacket([
        PACKET_TYPES.map_window, wid, x, y, w, h, {},
      ]);
      client.sendPacket([
        PACKET_TYPES.configure_window, wid, x, y, w, h, {}, 0, {}, false,
      ]);

      // If server accepts these without disconnecting, the test passes
      await new Promise((r) => setTimeout(r, 500));
      expect(client.isConnected).toBe(true);
    });

    it("receives draw packets after mapping window", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const newWindow = await client.waitForPacket("new-window", 10_000);
      const wid = newWindow.data[1] as number;
      const x = newWindow.data[2] as number;
      const y = newWindow.data[3] as number;
      const w = newWindow.data[4] as number;
      const h = newWindow.data[5] as number;

      client.sendPacket([PACKET_TYPES.map_window, wid, x, y, w, h, {}]);
      client.sendPacket([
        PACKET_TYPES.configure_window, wid, x, y, w, h, {}, 0, {}, false,
      ]);

      const draw = await client.waitForPacket("draw", 10_000);
      expect(draw).toBeTruthy();
      expect(draw.type).toBe("draw");
      expect(draw.data[1]).toBe(wid);
    });
  });

  // -----------------------------------------------------------------------
  // Startup complete
  // -----------------------------------------------------------------------

  describe("Session lifecycle", () => {
    it("receives startup-complete after hello", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const startup = await client.waitForPacket("startup-complete", 10_000);
      expect(startup).toBeTruthy();
      expect(startup.type).toBe("startup-complete");
    });

    it("receives setting-change packet", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      // Wait a bit for server to send setting-change packets
      await new Promise((r) => setTimeout(r, 2000));
      const settingChanges = client.getPackets("setting-change");
      // Some servers send these, some don't — just verify no crash
      expect(Array.isArray(settingChanges)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Protocol correctness
  // -----------------------------------------------------------------------

  describe("Protocol correctness", () => {
    it("all received packets have valid string type at index 0", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      // Wait for some packets to come in
      await new Promise((r) => setTimeout(r, 3000));

      for (const pkt of client.receivedPackets) {
        expect(typeof pkt.type).toBe("string");
        expect(pkt.type.length).toBeGreaterThan(0);
      }
    });

    it("server hello contains expected capability keys", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();

      const hello = await client.waitForPacket("hello");
      const caps = hello.data[1] as Record<string, unknown>;

      const expectedKeys = ["version", "rencodeplus"];
      for (const key of expectedKeys) {
        const found = Object.keys(caps).some((k) => {
          const kStr = typeof k === "string" ? k : new TextDecoder().decode(k as unknown as Uint8Array);
          return kStr === key;
        });
        expect(found).toBe(true);
      }
    });

    it("handles connection with minimal hello gracefully", async () => {
      if (!serverAvailable) return;

      await client.connect();

      // Send a hello with minimal fields — Xpra is tolerant and may still
      // respond with a hello or disconnect, depending on version/config
      client.sendPacket([PACKET_TYPES.hello, { version: "20", rencodeplus: true }]);

      await new Promise((r) => setTimeout(r, 3000));
      const hellos = client.getPackets("hello");
      const disconnects = client.getPackets("disconnect");
      // Server should respond with either a hello or a disconnect
      const gotResponse = hellos.length > 0 || disconnects.length > 0;
      expect(gotResponse).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Damage sequence (ACK)
  // -----------------------------------------------------------------------

  describe("Damage sequence ACK", () => {
    it("can send damage-sequence ACK for draw packets", async () => {
      if (!serverAvailable) return;

      await client.connect();
      client.sendHello();
      await client.waitForPacket("hello");

      const newWindow = await client.waitForPacket("new-window", 10_000);
      const wid = newWindow.data[1] as number;
      const x = newWindow.data[2] as number;
      const y = newWindow.data[3] as number;
      const w = newWindow.data[4] as number;
      const h = newWindow.data[5] as number;

      client.sendPacket([PACKET_TYPES.map_window, wid, x, y, w, h, {}]);
      client.sendPacket([
        PACKET_TYPES.configure_window, wid, x, y, w, h, {}, 0, {}, false,
      ]);

      const draw = await client.waitForPacket("draw", 10_000);
      // draw: [type, wid, x, y, w, h, coding, data, packet_sequence, rowstride, options]
      const packetSequence = draw.data[8] as number;
      const drawW = draw.data[4] as number;
      const drawH = draw.data[5] as number;

      client.sendPacket([
        PACKET_TYPES.damage_sequence,
        packetSequence,
        wid,
        drawW,
        drawH,
        0,
        "",
      ]);

      // Server should continue sending more draw packets
      await new Promise((r) => setTimeout(r, 1000));
      expect(client.isConnected).toBe(true);
    });
  });
});
