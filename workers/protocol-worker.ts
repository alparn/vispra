/*
 * Author: Ali Parnan
 *
 * Web Worker that runs the Xpra WebSocket protocol transport off the
 * main thread.  Communicates with XpraProtocolWorkerHost via the typed
 * HostToWorkerMessage / WorkerToHostMessage protocol.
 *
 * Heavy operations (rencode decode, LZ4/Brotli decompression, AES
 * encrypt/decrypt) all happen in this worker so the main thread stays
 * free for rendering.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

// Load rencode into the worker global scope before anything else
import "@/vendor/rencode.js";

import { XpraWebSocketTransport } from "@/core/protocol/websocket";
import type {
  HostToWorkerMessage,
  WorkerToHostMessage,
} from "@/core/protocol/worker-host";
import type { ServerPacket } from "@/core/protocol/types";

// ---------------------------------------------------------------------------
// Transferable extraction for zero-copy postMessage
// ---------------------------------------------------------------------------

function extractTransferables(packet: ServerPacket): Transferable[] {
  const transferables: Transferable[] = [];
  const type = packet[0];

  // draw packets: packet[7] is the image data buffer
  if (type === "draw") {
    const imgData = (packet as unknown[])[7];
    if (imgData && typeof imgData === "object" && "buffer" in (imgData as Uint8Array)) {
      transferables.push((imgData as Uint8Array).buffer);
    }
  }

  if (type === "send-file-chunk") {
    const fileData = (packet as unknown[])[3];
    if (fileData && typeof fileData === "object" && "buffer" in (fileData as Uint8Array)) {
      transferables.push((fileData as Uint8Array).buffer);
    }
  }

  if (type === "sound-data") {
    const soundBuf = (packet as unknown[])[2];
    if (soundBuf && typeof soundBuf === "object" && "buffer" in (soundBuf as Uint8Array)) {
      transferables.push((soundBuf as Uint8Array).buffer);
    }
  }

  return transferables;
}

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------

const protocol = new XpraWebSocketTransport();

protocol.setPacketHandler((packet: ServerPacket) => {
  const transferables = extractTransferables(packet);
  const msg: WorkerToHostMessage = { c: "p", p: packet };
  self.postMessage(msg, transferables);
});

// ---------------------------------------------------------------------------
// Message handler (host → worker)
// ---------------------------------------------------------------------------

self.addEventListener("message", (e: MessageEvent<HostToWorkerMessage>) => {
  const data = e.data;
  switch (data.c) {
    case "o":
      protocol.open(data.u);
      break;
    case "s":
      protocol.send(data.p);
      break;
    case "z":
      protocol.setCipherIn(data.p, data.k);
      break;
    case "x":
      protocol.setCipherOut(data.p, data.k);
      break;
    case "c":
      protocol.close();
      break;
    case "t":
      protocol.close();
      self.close();
      break;
    default: {
      const msg: WorkerToHostMessage = {
        c: "l",
        t: "unknown command from host",
      };
      self.postMessage(msg);
    }
  }
});

// Signal readiness to the host
self.postMessage({ c: "r" } satisfies WorkerToHostMessage);

export {};
