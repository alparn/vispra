/*
 * Author: Ali Parnan
 *
 * Main-thread host that delegates the Xpra wire protocol to a Web Worker.
 *
 * The worker runs an XpraWebSocketTransport internally and communicates
 * with this host via a typed message protocol (see WorkerMessage below).
 *
 * Implements WorkerProtocolTransport so the XpraClient orchestrator can
 * use it interchangeably with the direct WebSocket or WebTransport backends.
 */

import type { WorkerProtocolTransport } from "./transport";
import type {
  CipherCaps,
  ClientPacket,
  PacketHandler,
  ServerPacket,
} from "./types";
import { error as logError } from "@/core/utils/logging";

// ---------------------------------------------------------------------------
// Host <-> Worker message protocol
// ---------------------------------------------------------------------------

export type HostToWorkerMessage =
  | { c: "o"; u: string }
  | { c: "s"; p: ClientPacket }
  | { c: "z"; p: CipherCaps; k: string }
  | { c: "x"; p: CipherCaps; k: string }
  | { c: "c" }
  | { c: "t" };

export type WorkerToHostMessage =
  | { c: "r" }
  | { c: "p"; p: ServerPacket }
  | { c: "l"; t: string }
  | { c: "e"; t: string };

// ---------------------------------------------------------------------------
// XpraProtocolWorkerHost
// ---------------------------------------------------------------------------

export class XpraProtocolWorkerHost implements WorkerProtocolTransport {
  private worker: Worker | null = null;
  private packetHandler: PacketHandler | null = null;
  private pendingUri: string | null = null;

  open(uri: string): void {
    if (this.worker) {
      this.post({ c: "o", u: uri });
      return;
    }

    this.pendingUri = uri;
    this.worker = new Worker(
      new URL("../../../workers/protocol-worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.addEventListener("message", (e: MessageEvent<WorkerToHostMessage>) => {
      const data = e.data;
      switch (data.c) {
        case "r":
          if (this.pendingUri) {
            this.post({ c: "o", u: this.pendingUri });
            this.pendingUri = null;
          }
          break;
        case "p":
          if (this.packetHandler) {
            this.packetHandler(data.p);
          }
          break;
        case "l":
          console.log(data.t);
          break;
        case "e":
          logError(data.t);
          break;
        default:
          logError("unknown command from protocol worker:", e.data);
      }
    });

    this.worker.addEventListener("error", (event: ErrorEvent) => {
      logError("protocol worker error:", event.message);
      if (this.packetHandler) {
        this.packetHandler(["error", `worker error: ${event.message}`, 0] as ServerPacket);
      }
    });
  }

  close(): void {
    this.post({ c: "c" });
  }

  terminate(): void {
    this.post({ c: "t" });
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  send(packet: ClientPacket): void {
    this.post({ c: "s", p: packet });
  }

  setPacketHandler(handler: PacketHandler): void {
    this.packetHandler = handler;
  }

  setCipherIn(caps: CipherCaps, key: string): void {
    this.post({ c: "z", p: caps, k: key });
  }

  setCipherOut(caps: CipherCaps, key: string): void {
    this.post({ c: "x", p: caps, k: key });
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private post(msg: HostToWorkerMessage): void {
    if (!this.worker) {
      logError("cannot post to worker - worker is not initialised");
      return;
    }

    const transferables = extractTransferables(msg);
    if (transferables.length > 0) {
      this.worker.postMessage(msg, transferables);
    } else {
      this.worker.postMessage(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Transfer optimisation
// ---------------------------------------------------------------------------

function extractTransferables(msg: HostToWorkerMessage): Transferable[] {
  if (msg.c !== "s") return [];

  const packet = msg.p;
  const buffers: Transferable[] = [];

  for (const item of packet) {
    if (item instanceof ArrayBuffer) {
      buffers.push(item);
    } else if (ArrayBuffer.isView(item) && item.buffer instanceof ArrayBuffer) {
      buffers.push(item.buffer);
    }
  }
  return buffers;
}
