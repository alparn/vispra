/*
 * Author: Ali Parnan
 *
 * Xpra wire protocol over WebTransport.
 *
 * Port of the legacy WebTransport.js to TypeScript,
 * implementing the ProtocolTransport interface.
 *
 * WebTransport provides a lower-latency, multiplexed alternative to
 * WebSocket. Encryption is handled at the QUIC layer — application-level
 * AES cipher is not supported over WebTransport.
 */

import type { ProtocolTransport } from "./transport";
import type {
  CipherCaps,
  ClientPacket,
  PacketHandler,
  ServerPacket,
} from "./types";
import {
  HEADER_SIZE,
  HEADER_MAGIC,
  ProtoFlags,
  CompressionLevel,
} from "./types";
import { error as logError, log as logInfo } from "@/core/utils/logging";

import { decompressBlock as lz4DecompressBlock } from "lz4js";

/* eslint-disable @typescript-eslint/no-explicit-any */

declare function rencode(obj: unknown): Uint8Array;
declare function rdecode(buf: Uint8Array): any;

function xpraLz4Decode(data: Uint8Array): Uint8Array {
  const length =
    data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  if (length <= 0 || length > 0x4000_0000) {
    throw new Error(`lz4: invalid uncompressed size: ${length}`);
  }
  const inflated = new Uint8Array(length);
  lz4DecompressBlock(data, inflated, 4, data.length - 4, 0);
  return inflated;
}

let brotliDecompress: ((data: Uint8Array) => Uint8Array) | null = null;

async function ensureBrotli(): Promise<void> {
  if (brotliDecompress) return;
  const mod = await import("brotli-wasm");
  const brotli = await mod.default;
  brotliDecompress = (data: Uint8Array) => brotli.decompress(data);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// WebTransport type declarations (not yet in all TS lib targets)
// ---------------------------------------------------------------------------

interface WebTransportBidirectionalStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

interface WebTransportInstance {
  readonly ready: Promise<void>;
  readonly closed: Promise<WebTransportCloseInfo>;
  close(closeInfo?: WebTransportCloseInfo): void;
  createBidirectionalStream(): Promise<WebTransportBidirectionalStream>;
}

interface WebTransportCloseInfo {
  closeCode?: number;
  reason?: string;
}

declare const WebTransport: {
  new (url: string, options?: Record<string, unknown>): WebTransportInstance;
};

// ---------------------------------------------------------------------------
// XpraWebTransportProtocol
// ---------------------------------------------------------------------------

/**
 * Xpra wire protocol transport over a WebTransport bidirectional stream.
 *
 * Handles:
 *  - 8-byte header framing (magic 'P', proto-flags, compression, size)
 *  - rencodeplus serialisation / deserialisation
 *  - LZ4 / Brotli decompression of incoming packets
 *  - send & receive queues with async processing
 *  - raw (chunked) packet reassembly
 *
 * Encryption at the application layer is NOT supported — WebTransport runs
 * over QUIC which provides TLS 1.3 encryption natively.
 */
export class XpraWebTransportProtocol implements ProtocolTransport {
  // -- WebTransport state --
  private transport: WebTransportInstance | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private connectTimer = 0;

  // -- Queues --
  private rQ: Uint8Array[] = [];
  private sQ: ClientPacket[] = [];
  private header: number[] = [];
  private rawPackets: Record<number, Uint8Array> = {};

  // -- Processing interval (ms). 0 = process immediately via microtask. --
  private processInterval = 0;

  // -- Packet handler --
  private packetHandler: PacketHandler | null = null;

  // -----------------------------------------------------------------------
  // ProtocolTransport interface
  // -----------------------------------------------------------------------

  open(uri: string): void {
    this.rQ = [];
    this.sQ = [];
    this.header = [];
    this.rawPackets = {};
    this.closeTransport();

    ensureBrotli().catch((err) =>
      logError("brotli-wasm init failed (Brotli decompression will not work):", err),
    );

    this.connectTimer = window.setTimeout(
      () => this.emit(["error", "connection timed out", 0] as ServerPacket),
      CONNECT_TIMEOUT,
    );

    let wt: WebTransportInstance;
    try {
      logInfo("opening WebTransport connection to", uri);
      wt = new WebTransport(uri);
    } catch (err) {
      this.emit(["error", String(err), 0] as ServerPacket);
      return;
    }
    this.transport = wt;

    this.initTransport(wt);
  }

  close(): void {
    this.closeTransport();
  }

  send(packet: ClientPacket): void {
    this.sQ.push(packet);
    setTimeout(() => this.processSendQueue(), this.processInterval);
  }

  setPacketHandler(handler: PacketHandler): void {
    this.packetHandler = handler;
  }

  setCipherIn(_caps: CipherCaps, _key: string): void {
    throw new Error("application-level encryption is not supported with WebTransport");
  }

  setCipherOut(_caps: CipherCaps, _key: string): void {
    throw new Error("application-level encryption is not supported with WebTransport");
  }

  // -----------------------------------------------------------------------
  // Async initialisation (must be separate because open() is synchronous)
  // -----------------------------------------------------------------------

  private async initTransport(wt: WebTransportInstance): Promise<void> {
    try {
      await wt.ready;
      this.clearConnectTimer();
    } catch (err) {
      logError("WebTransport connection failed:", err);
      this.clearConnectTimer();
      this.emit(["error", String(err), 0] as ServerPacket);
      return;
    }

    wt.closed
      .then((info) => {
        const reason = info?.reason ?? "transport closed";
        this.emit(["close", reason] as ServerPacket);
      })
      .catch((err) => {
        logError("error closing WebTransport:", err);
        this.emit(["close", `error: ${String(err)}`] as ServerPacket);
      });

    let stream: WebTransportBidirectionalStream;
    try {
      stream = await wt.createBidirectionalStream();
    } catch (err) {
      logError("failed to create bidirectional stream:", err);
      this.emit(["error", `stream creation failed: ${String(err)}`, 0] as ServerPacket);
      return;
    }
    this.writer = stream.writable.getWriter();

    this.readLoop(stream)
      .then(() => {
        this.emit(["close", "read loop ended"] as ServerPacket);
      })
      .catch((err) => {
        logError("error in WebTransport read loop:", err);
        this.emit(["close", `read loop error: ${String(err)}`] as ServerPacket);
      });

    this.emit(["open"] as ServerPacket);
  }

  // -----------------------------------------------------------------------
  // Read loop (stream → receive queue)
  // -----------------------------------------------------------------------

  private async readLoop(stream: WebTransportBidirectionalStream): Promise<void> {
    const reader = stream.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.rQ.push(value);
        setTimeout(() => this.processReceiveQueue(), this.processInterval);
      }
    } finally {
      reader.releaseLock();
    }
  }

  // -----------------------------------------------------------------------
  // Receive path
  // -----------------------------------------------------------------------

  private processReceiveQueue(): void {
    while (this.transport && this.rQ.length > 0 && this.doProcessReceiveQueue());
  }

  private doProcessReceiveQueue(): boolean {
    // --- Accumulate 8-byte header ---
    if (this.header.length < HEADER_SIZE && this.rQ.length > 0) {
      while (this.header.length < HEADER_SIZE && this.rQ.length > 0) {
        const slice = this.rQ[0];
        const needed = HEADER_SIZE - this.header.length;
        const n = Math.min(needed, slice.length);
        for (let i = 0; i < n; i++) {
          this.header.push(slice[i]);
        }
        if (slice.length > needed) {
          this.rQ[0] = slice.subarray(n);
        } else {
          this.rQ.shift();
        }
      }

      if (this.header[0] !== HEADER_MAGIC) {
        let message = `invalid packet header format: ${this.header[0]}`;
        if (this.header.length > 1) {
          const hex = this.header
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          message += `: 0x${hex}`;
        }
        this.protocolError(message);
        return false;
      }
    }

    if (this.header.length < HEADER_SIZE) {
      return false;
    }

    // --- Parse header fields ---
    let protoFlags = this.header[1];
    const encrypted = (protoFlags & ProtoFlags.ENCRYPTED) !== 0;
    if (encrypted) {
      this.protocolError("encrypted packets are not supported over WebTransport");
      return false;
    }

    // Bit 0x08 is unused client-side; strip it.
    protoFlags = protoFlags & ~ProtoFlags.UNUSED;

    if (
      protoFlags > ProtoFlags.RENCODE_LEGACY &&
      protoFlags !== ProtoFlags.RENCODEPLUS
    ) {
      this.protocolError(
        `unsupported protocol flags: 0x${protoFlags.toString(16)}`,
      );
      return false;
    }

    const level = this.header[2];
    if (level & CompressionLevel.LZO) {
      this.protocolError("lzo compression is not supported");
      return false;
    }

    const index = this.header[3];
    if (index >= 20) {
      this.protocolError(`invalid packet index: ${index}`);
      return false;
    }

    let packetSize =
      (this.header[4] << 24) |
      (this.header[5] << 16) |
      (this.header[6] << 8) |
      this.header[7];
    packetSize >>>= 0;

    // Check if enough data is buffered
    const buffered = this.rQ.reduce((sum, buf) => sum + buf.length, 0);
    if (buffered < packetSize) {
      return false;
    }

    // Consume header — next packet will need a fresh one
    this.header = [];

    // --- Assemble payload ---
    let packetData: Uint8Array;
    if (this.rQ.length > 0 && this.rQ[0].length === packetSize) {
      packetData = this.rQ.shift()!;
    } else {
      packetData = new Uint8Array(packetSize);
      let offset = 0;
      while (offset < packetSize) {
        const slice = this.rQ[0];
        const needed = packetSize - offset;
        if (slice.length > needed) {
          packetData.set(slice.subarray(0, needed), offset);
          offset += needed;
          this.rQ[0] = slice.subarray(needed);
        } else {
          packetData.set(slice, offset);
          offset += slice.length;
          this.rQ.shift();
        }
      }
    }

    // --- Decompress if needed ---
    if (level !== CompressionLevel.NONE) {
      if (level & CompressionLevel.LZ4) {
        packetData = xpraLz4Decode(packetData);
      } else if (level & CompressionLevel.BROTLI) {
        if (!brotliDecompress) {
          this.protocolError(
            "received Brotli-compressed packet but brotli-wasm is not loaded",
          );
          return false;
        }
        packetData = brotliDecompress(packetData);
      } else {
        this.protocolError(`unsupported compressor: 0x${level.toString(16)}`);
        return false;
      }
    }

    // --- Chunked (raw) packets ---
    if (index > 0) {
      this.rawPackets[index] = packetData;
      if (Object.keys(this.rawPackets).length >= 4) {
        this.protocolError(
          `too many raw packets: ${Object.keys(this.rawPackets).length}`,
        );
      }
      return this.rQ.length > 0;
    }

    // --- Decode ---
    let packet: any;
    try {
      if (protoFlags === ProtoFlags.RENCODEPLUS) {
        packet = rdecode(packetData);
      } else if (protoFlags === ProtoFlags.RENCODE_LEGACY) {
        this.protocolError(
          `rencode legacy mode is not supported, protocol flag: ${protoFlags}`,
        );
        return false;
      } else {
        this.protocolError(`invalid packet encoder flags: ${protoFlags}`);
        return false;
      }
      for (const rawIdx in this.rawPackets) {
        packet[rawIdx] = this.rawPackets[rawIdx];
      }
      this.rawPackets = {};
    } catch (err) {
      logError("error decoding packet:", err);
      logError("packet data:", packetData);
      logError("protocol flags:", protoFlags);
      this.rawPackets = {};
      return this.rQ.length > 0;
    }

    try {
      this.emit(packet as ServerPacket);
    } catch (err) {
      logError(`error processing packet ${packet[0]}:`, err);
    }

    return this.rQ.length > 0;
  }

  // -----------------------------------------------------------------------
  // Send path
  // -----------------------------------------------------------------------

  private processSendQueue(): void {
    while (this.sQ.length > 0 && this.transport) {
      const packet = this.sQ.shift();
      if (!packet) return;

      let bdata: Uint8Array;
      try {
        bdata = rencode(packet);
      } catch (err) {
        logError("failed to encode packet:", packet, err);
        continue;
      }

      const payloadSize = bdata.length;
      const frame = new Uint8Array(HEADER_SIZE + payloadSize);

      frame[0] = HEADER_MAGIC;
      frame[1] = ProtoFlags.RENCODEPLUS;
      frame[2] = CompressionLevel.NONE;
      frame[3] = 0;
      frame[4] = (payloadSize >>> 24) & 0xff;
      frame[5] = (payloadSize >>> 16) & 0xff;
      frame[6] = (payloadSize >>> 8) & 0xff;
      frame[7] = payloadSize & 0xff;
      frame.set(bdata, HEADER_SIZE);

      if (this.writer) {
        this.writer.write(frame).catch((err) => {
          logError("WebTransport write error:", err);
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private emit(packet: ServerPacket): void {
    if (this.packetHandler) {
      this.packetHandler(packet);
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = 0;
    }
  }

  private closeTransport(): void {
    this.clearConnectTimer();
    if (this.writer) {
      this.writer.close().catch(() => { /* ignore */ });
      this.writer = null;
    }
    if (this.transport) {
      try {
        this.transport.close({ closeCode: 0, reason: "client closed" });
      } catch {
        /* already closed */
      }
      this.transport = null;
    }
  }

  private protocolError(message: string): void {
    logError("protocol error:", message);
    this.closeTransport();
    this.header = [];
    this.rQ = [];
    this.emit(["close", message] as ServerPacket);
  }
}
