import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { XpraWebSocketTransport } from "../websocket";
import type { ServerPacket } from "../types";
import { HEADER_MAGIC, ProtoFlags, HEADER_SIZE } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Minimal rencode stub — the real vendor/rencode.js is not available in tests.
// We define global rencode/rdecode that just do JSON-over-Uint8Array.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

(globalThis as any).rencode = (obj: unknown): Uint8Array => {
  return encoder.encode(JSON.stringify(obj));
};

(globalThis as any).rdecode = (buf: Uint8Array): any => {
  return JSON.parse(decoder.decode(buf));
};

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WSListener = (event: any) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  binaryType = "";
  readyState = 0; // CONNECTING
  sentBuffers: ArrayBuffer[] = [];

  private listeners: Record<string, WSListener[]> = {};

  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;

  constructor(
    public url: string,
    public protocol: string,
  ) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: WSListener): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: WSListener): void {
    const list = this.listeners[type];
    if (list) {
      this.listeners[type] = list.filter((l) => l !== listener);
    }
  }

  dispatchEvent(type: string, event: any): void {
    for (const fn of this.listeners[type] ?? []) {
      fn(event);
    }
  }

  send(data: ArrayBuffer): void {
    this.sentBuffers.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // Helper: simulate the server opening the connection
  simulateOpen(): void {
    this.readyState = 1;
    this.dispatchEvent("open", {});
  }

  // Helper: simulate receiving a binary message
  simulateMessage(data: ArrayBuffer): void {
    this.dispatchEvent("message", { data });
  }

  // Helper: simulate close
  simulateClose(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.dispatchEvent("close", { code, reason });
  }
}

// ---------------------------------------------------------------------------
// Install mock
// ---------------------------------------------------------------------------

let savedWebSocket: any;

beforeEach(() => {
  MockWebSocket.instances = [];
  savedWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  (globalThis as any).WebSocket = savedWebSocket;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastWS(): MockWebSocket {
  const instances = MockWebSocket.instances;
  return instances[instances.length - 1];
}

function buildFrame(packet: any, protoFlags = ProtoFlags.RENCODEPLUS): ArrayBuffer {
  const payload = encoder.encode(JSON.stringify(packet));
  const frame = new Uint8Array(HEADER_SIZE + payload.length);
  frame[0] = HEADER_MAGIC;
  frame[1] = protoFlags;
  frame[2] = 0; // no compression
  frame[3] = 0; // index 0 (complete packet)
  frame[4] = (payload.length >>> 24) & 0xff;
  frame[5] = (payload.length >>> 16) & 0xff;
  frame[6] = (payload.length >>> 8) & 0xff;
  frame[7] = payload.length & 0xff;
  frame.set(payload, HEADER_SIZE);
  return frame.buffer;
}

function collectPackets(transport: XpraWebSocketTransport): ServerPacket[] {
  const packets: ServerPacket[] = [];
  transport.setPacketHandler((p) => packets.push(p));
  return packets;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("XpraWebSocketTransport", () => {
  it("creates a WebSocket with binary protocol", () => {
    const transport = new XpraWebSocketTransport();
    transport.setPacketHandler(() => {});
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    expect(ws.url).toBe("ws://localhost:10000");
    expect(ws.protocol).toBe("binary");
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("emits 'open' when WebSocket connects", async () => {
    const transport = new XpraWebSocketTransport();
    const packets = collectPackets(transport);
    transport.open("ws://localhost:10000");

    getLastWS().simulateOpen();

    expect(packets.length).toBe(1);
    expect(packets[0][0]).toBe("open");
  });

  it("emits 'close' when WebSocket closes", () => {
    const transport = new XpraWebSocketTransport();
    const packets = collectPackets(transport);
    transport.open("ws://localhost:10000");

    getLastWS().simulateOpen();
    getLastWS().simulateClose(1000, "bye");

    expect(packets.length).toBe(2);
    expect(packets[1][0]).toBe("close");
    expect((packets[1] as any)[1]).toContain("Normal Closure");
  });

  it("decodes an incoming rencode packet", async () => {
    const transport = new XpraWebSocketTransport();
    const packets = collectPackets(transport);
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    ws.simulateOpen();

    const serverPacket = ["hello", { version: "5.0" }];
    ws.simulateMessage(buildFrame(serverPacket));

    // processReceiveQueue is called via setTimeout; flush microtasks
    await vi.waitFor(() => {
      expect(packets.length).toBeGreaterThanOrEqual(2);
    });

    const decoded = packets.find((p) => p[0] === "hello");
    expect(decoded).toBeTruthy();
    expect((decoded as any)[1]).toEqual({ version: "5.0" });
  });

  it("sends a framed rencode packet", async () => {
    const transport = new XpraWebSocketTransport();
    transport.setPacketHandler(() => {});
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    ws.simulateOpen();

    transport.send(["hello", { version: "5.0" }] as any);

    await vi.waitFor(() => {
      expect(ws.sentBuffers.length).toBe(1);
    });

    const sent = new Uint8Array(ws.sentBuffers[0]);
    expect(sent[0]).toBe(HEADER_MAGIC);
    expect(sent[1]).toBe(ProtoFlags.RENCODEPLUS);

    const payloadSize =
      (sent[4] << 24) | (sent[5] << 16) | (sent[6] << 8) | sent[7];
    expect(payloadSize).toBeGreaterThan(0);
    expect(sent.length).toBe(HEADER_SIZE + payloadSize);

    const payloadBytes = sent.subarray(HEADER_SIZE);
    const decoded = JSON.parse(decoder.decode(payloadBytes));
    expect(decoded[0]).toBe("hello");
  });

  it("handles multiple messages in receive queue", async () => {
    const transport = new XpraWebSocketTransport();
    const packets = collectPackets(transport);
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    ws.simulateOpen();

    ws.simulateMessage(buildFrame(["ping", 12345]));
    ws.simulateMessage(buildFrame(["ping", 67890]));

    await vi.waitFor(() => {
      const pings = packets.filter((p) => p[0] === "ping");
      expect(pings.length).toBe(2);
    });
  });

  it("handles split header across multiple messages", async () => {
    const transport = new XpraWebSocketTransport();
    const packets = collectPackets(transport);
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    ws.simulateOpen();

    const fullFrame = new Uint8Array(buildFrame(["ping", 42]));

    const buf1 = new ArrayBuffer(4);
    new Uint8Array(buf1).set(fullFrame.subarray(0, 4));
    const buf2 = new ArrayBuffer(fullFrame.length - 4);
    new Uint8Array(buf2).set(fullFrame.subarray(4));

    ws.simulateMessage(buf1);
    ws.simulateMessage(buf2);

    await vi.waitFor(() => {
      const pings = packets.filter((p) => p[0] === "ping");
      expect(pings.length).toBe(1);
    });

    const ping = packets.find((p) => p[0] === "ping") as any;
    expect(ping[1]).toBe(42);
  });

  it("reports protocol error for invalid header magic", async () => {
    const transport = new XpraWebSocketTransport();
    const packets = collectPackets(transport);
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    ws.simulateOpen();

    const badFrame = new Uint8Array(16);
    badFrame[0] = 0xff; // invalid magic
    ws.simulateMessage(badFrame.buffer);

    await vi.waitFor(() => {
      const closePackets = packets.filter((p) => p[0] === "close");
      expect(closePackets.length).toBe(1);
    });

    const close = packets.find((p) => p[0] === "close") as any;
    expect(close[1]).toContain("invalid packet header");
  });

  it("close() nullifies the WebSocket", () => {
    const transport = new XpraWebSocketTransport();
    transport.setPacketHandler(() => {});
    transport.open("ws://localhost:10000");

    const ws = getLastWS();
    ws.simulateOpen();
    transport.close();

    expect(ws.readyState).toBe(3);
  });

  it("emits 'error' on connection timeout", async () => {
    vi.useFakeTimers();
    try {
      const transport = new XpraWebSocketTransport();
      const packets = collectPackets(transport);
      transport.open("ws://localhost:10000");

      vi.advanceTimersByTime(15_001);

      const errorPacket = packets.find((p) => p[0] === "error");
      expect(errorPacket).toBeTruthy();
      expect((errorPacket as any)[1]).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("can reconnect after close", () => {
    const transport = new XpraWebSocketTransport();
    transport.setPacketHandler(() => {});
    transport.open("ws://localhost:10000");

    const ws1 = getLastWS();
    ws1.simulateOpen();
    transport.close();

    transport.open("ws://localhost:10001");
    const ws2 = getLastWS();
    expect(ws2).not.toBe(ws1);
    expect(ws2.url).toBe("ws://localhost:10001");
  });
});
