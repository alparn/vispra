import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { XpraProtocolWorkerHost } from "../worker-host";
import type { WorkerToHostMessage } from "../worker-host";
import type { ServerPacket } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------

type WorkerListener = (event: any) => void;

class MockWorker {
  static instances: MockWorker[] = [];
  postedMessages: { msg: any; transfer?: Transferable[] }[] = [];

  private listeners: Record<string, WorkerListener[]> = {};

  constructor(
    public url: URL | string,
    public options?: WorkerOptions,
  ) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: WorkerListener): void {
    const list = this.listeners[type];
    if (list) {
      this.listeners[type] = list.filter((l) => l !== listener);
    }
  }

  postMessage(msg: any, transfer?: Transferable[]): void {
    this.postedMessages.push({ msg, transfer });
  }

  terminate(): void {
    // no-op
  }

  simulateMessage(data: WorkerToHostMessage): void {
    for (const fn of this.listeners["message"] ?? []) {
      fn({ data } as MessageEvent);
    }
  }

  simulateError(message: string): void {
    for (const fn of this.listeners["error"] ?? []) {
      fn({ message } as ErrorEvent);
    }
  }
}

// ---------------------------------------------------------------------------
// Install mock
// ---------------------------------------------------------------------------

let savedWorker: any;

beforeEach(() => {
  MockWorker.instances = [];
  savedWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = MockWorker;
});

afterEach(() => {
  (globalThis as any).Worker = savedWorker;
});

function getLastWorker(): MockWorker {
  return MockWorker.instances[MockWorker.instances.length - 1];
}

function msgs(w: MockWorker): any[] {
  return w.postedMessages.map((p) => p.msg);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("XpraProtocolWorkerHost", () => {
  it("creates a Worker and sends open command after ready", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    expect(w).toBeTruthy();
    expect(w.options?.type).toBe("module");

    w.simulateMessage({ c: "r" });

    const openMsg = msgs(w).find((m) => m.c === "o");
    expect(openMsg).toBeTruthy();
    expect(openMsg.u).toBe("ws://localhost:10000");
  });

  it("dispatches received packets to the handler", () => {
    const host = new XpraProtocolWorkerHost();
    const packets: ServerPacket[] = [];
    host.setPacketHandler((p) => packets.push(p));
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    w.simulateMessage({ c: "p", p: ["hello", { version: "5.0" }] as any });

    expect(packets.length).toBe(1);
    expect(packets[0][0]).toBe("hello");
    expect((packets[0] as any)[1]).toEqual({ version: "5.0" });
  });

  it("re-uses existing worker on second open()", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    const countBefore = MockWorker.instances.length;
    host.open("ws://localhost:20000");
    expect(MockWorker.instances.length).toBe(countBefore);

    const openMsgs = msgs(w).filter((m) => m.c === "o");
    expect(openMsgs.length).toBe(2);
    expect(openMsgs[1].u).toBe("ws://localhost:20000");
  });

  it("send() posts a packet command to the worker", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    host.send(["hello", { version: "5.0" }] as any);

    const sendMsg = msgs(w).find((m) => m.c === "s");
    expect(sendMsg).toBeTruthy();
    expect(sendMsg.p[0]).toBe("hello");
  });

  it("close() posts a close command", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    host.close();

    const closeMsg = msgs(w).find((m) => m.c === "c");
    expect(closeMsg).toBeTruthy();
  });

  it("terminate() posts terminate and kills worker", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    const spy = vi.spyOn(w, "terminate");
    host.terminate();

    const termMsg = msgs(w).find((m) => m.c === "t");
    expect(termMsg).toBeTruthy();
    expect(spy).toHaveBeenCalled();
  });

  it("setCipherIn posts cipher-in command", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    host.setCipherIn({ cipher: "AES", mode: "CBC" }, "secret");

    const msg = msgs(w).find((m) => m.c === "z");
    expect(msg).toBeTruthy();
    expect(msg.p.cipher).toBe("AES");
    expect(msg.k).toBe("secret");
  });

  it("setCipherOut posts cipher-out command", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    host.setCipherOut({ cipher: "AES", mode: "GCM" }, "key123");

    const msg = msgs(w).find((m) => m.c === "x");
    expect(msg).toBeTruthy();
    expect(msg.p.mode).toBe("GCM");
    expect(msg.k).toBe("key123");
  });

  it("logs worker 'l' messages to console", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });
    w.simulateMessage({ c: "l", t: "test log message" });

    expect(logSpy).toHaveBeenCalledWith("test log message");
    logSpy.mockRestore();
  });

  it("emits error packet on worker error event", () => {
    const host = new XpraProtocolWorkerHost();
    const packets: ServerPacket[] = [];
    host.setPacketHandler((p) => packets.push(p));
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateError("something broke");

    expect(packets.length).toBe(1);
    expect(packets[0][0]).toBe("error");
    expect((packets[0] as any)[1]).toContain("worker error");
  });

  it("handles multiple packets in sequence", () => {
    const host = new XpraProtocolWorkerHost();
    const packets: ServerPacket[] = [];
    host.setPacketHandler((p) => packets.push(p));
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    w.simulateMessage({ c: "p", p: ["open"] as any });
    w.simulateMessage({ c: "p", p: ["ping", 12345] as any });
    w.simulateMessage({ c: "p", p: ["ping", 67890] as any });

    expect(packets.length).toBe(3);
    expect(packets[0][0]).toBe("open");
    expect(packets[1][0]).toBe("ping");
    expect(packets[2][0]).toBe("ping");
  });

  it("extracts transferables for packets with ArrayBuffers", () => {
    const host = new XpraProtocolWorkerHost();
    host.setPacketHandler(() => {});
    host.open("ws://localhost:10000");

    const w = getLastWorker();
    w.simulateMessage({ c: "r" });

    const buf = new Uint8Array([1, 2, 3]);
    host.send(["send-file-chunk", "id1", 0, buf, true] as any);

    const entry = w.postedMessages.find((p) => p.msg.c === "s");
    expect(entry).toBeTruthy();
    expect(entry!.transfer).toBeTruthy();
    expect(entry!.transfer!.length).toBeGreaterThan(0);
  });
});
