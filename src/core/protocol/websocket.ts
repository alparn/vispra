/*
 * Author: Ali Parnan
 *
 * Xpra wire protocol over WebSocket.
 *
 * Port of the legacy Protocol.js XpraProtocol class to TypeScript,
 * implementing the ProtocolTransport interface.
 *
 * Requires: lz4js (npm), brotli-wasm (npm), vendor/rencode.js
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
import type { CipherState } from "./encryption";
import {
  setupCipher,
  encryptPacket,
  decryptPacket,
  paddingForSize,
} from "./encryption";
import { error as logError } from "@/core/utils/logging";

// ---------------------------------------------------------------------------
// External codec imports
// ---------------------------------------------------------------------------

import { decompressBlock as lz4DecompressBlock } from "lz4js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Xpra LZ4 decoding: 4-byte LE uncompressed-length prefix + raw LZ4 block.
 * This matches the encoding used by the Xpra server (see legacy lz4.decode).
 */
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

// rencode.js is a vendor script that exposes globals; we reference the
// ambient declarations from src/vendor/rencode.d.ts.
declare function rencode(obj: unknown): Uint8Array;
declare function rdecode(buf: Uint8Array): any;

// brotli-wasm is loaded lazily since the WASM module must be initialised.
// The default export is a Promise<BrotliModule> where BrotliModule has .decompress().
let brotliDecompress: ((data: Uint8Array) => Uint8Array) | null = null;

async function ensureBrotli(): Promise<void> {
  if (brotliDecompress) return;
  const mod = await import("brotli-wasm");
  const brotli = await mod.default;
  brotliDecompress = (data: Uint8Array) => brotli.decompress(data);
}

// ---------------------------------------------------------------------------
// WebSocket close-code descriptions
// ---------------------------------------------------------------------------

const WS_CLOSE_CODES: Record<number, string> = {
  1000: "Normal Closure",
  1001: "Going Away",
  1002: "Protocol Error",
  1003: "Unsupported Data",
  1004: "(For future)",
  1005: "No Status Received",
  1006: "Abnormal Closure",
  1007: "Invalid frame payload data",
  1008: "Policy Violation",
  1009: "Message too big",
  1010: "Missing Extension",
  1011: "Internal Error",
  1012: "Service Restart",
  1013: "Try Again Later",
  1014: "Bad Gateway",
  1015: "TLS Handshake",
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// XpraWebSocketTransport
// ---------------------------------------------------------------------------

/**
 * Xpra wire protocol transport over a single WebSocket connection.
 *
 * Handles:
 *  - 8-byte header framing (magic 'P', proto-flags, compression, size)
 *  - rencode serialisation / deserialisation
 *  - LZ4 / Brotli decompression of incoming packets
 *  - AES-CBC/CTR/GCM encryption / decryption via Web Crypto
 *  - send & receive queues with async processing
 *  - raw (chunked) packet reassembly
 */
export class XpraWebSocketTransport implements ProtocolTransport {
  // -- WebSocket --
  private ws: WebSocket | null = null;
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

  // -- Encryption state --
  private cipherIn: CipherState | null = null;
  private cipherOut: CipherState | null = null;

  // -----------------------------------------------------------------------
  // ProtocolTransport interface
  // -----------------------------------------------------------------------

  open(uri: string): void {
    this.rQ = [];
    this.sQ = [];
    this.header = [];
    this.rawPackets = {};
    this.closeSocket();

    ensureBrotli().catch((err) =>
      logError("brotli-wasm init failed (Brotli decompression will not work):", err),
    );

    this.connectTimer = setTimeout(
      () => this.emit(["error", "connection timed out", 0] as ServerPacket),
      CONNECT_TIMEOUT,
    ) as unknown as number;

    let ws: WebSocket;
    try {
      ws = new WebSocket(uri, "binary");
    } catch (err) {
      this.emit(["error", String(err), 0] as ServerPacket);
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.clearConnectTimer();
      this.emit(["open"] as ServerPacket);
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      this.emit(["close", closeEventStr(event)] as ServerPacket);
    });

    ws.addEventListener("error", (event: Event) => {
      const code = (event as any).code ?? 0;
      this.emit(["error", closeEventStr(event as any), code] as ServerPacket);
    });

    ws.addEventListener("message", (e: MessageEvent) => {
      this.rQ.push(new Uint8Array(e.data as ArrayBuffer));
      setTimeout(() => this.processReceiveQueue(), this.processInterval);
    });
  }

  close(): void {
    this.closeSocket();
  }

  send(packet: ClientPacket): void {
    this.sQ.push(packet);
    setTimeout(() => this.processSendQueue(), this.processInterval);
  }

  setPacketHandler(handler: PacketHandler): void {
    this.packetHandler = handler;
  }

  setCipherIn(caps: CipherCaps, key: string): void {
    setupCipher(caps, key, "decrypt")
      .then((state) => { this.cipherIn = state; })
      .catch((err) => this.protocolError(`failed to setup decrypt cipher: ${err}`));
  }

  setCipherOut(caps: CipherCaps, key: string): void {
    setupCipher(caps, key, "encrypt")
      .then((state) => { this.cipherOut = state; })
      .catch((err) => this.protocolError(`failed to setup encrypt cipher: ${err}`));
  }

  // -----------------------------------------------------------------------
  // Receive path
  // -----------------------------------------------------------------------

  private processReceiveQueue(): void {
    while (this.ws && this.rQ.length > 0 && this.doProcessReceiveQueue());
  }

  /**
   * Parses exactly one packet (or chunk) from the receive queue.
   * Returns `true` if more data may be available, `false` to stop.
   */
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
    // Bit 0x08 is unused client-side; strip it.
    let protoFlags = this.header[1] & ~ProtoFlags.UNUSED;
    const encrypted = (protoFlags & ProtoFlags.ENCRYPTED) !== 0;
    if (encrypted) {
      protoFlags &= ~ProtoFlags.ENCRYPTED;
    }
    if (
      protoFlags > ProtoFlags.RENCODE_LEGACY &&
      protoFlags !== ProtoFlags.RENCODEPLUS
    ) {
      this.protocolError(
        `unsupported protocol flags: 0x${protoFlags.toString(16)}`,
      );
      return false;
    }

    let packetSize =
      (this.header[4] << 24) |
      (this.header[5] << 16) |
      (this.header[6] << 8) |
      this.header[7];
    packetSize >>>= 0; // ensure unsigned

    // PKCS#7 padding for encrypted payloads
    let padding = 0;
    if (encrypted && this.cipherIn) {
      padding = paddingForSize(this.cipherIn.blockSize, packetSize);
      packetSize += padding;
    }

    // Check if enough data is buffered
    const buffered = this.rQ.reduce((sum, buf) => sum + buf.length, 0);
    if (buffered < packetSize) {
      return false;
    }

    // Consume header — next packet will need a fresh one
    const header = this.header;
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

    // --- Decrypt if needed ---
    if (encrypted) {
      if (!this.cipherIn) {
        this.protocolError(
          "encrypted packet received, but no decryption is configured",
        );
        return false;
      }
      const expectedPlainSize = packetSize - padding - 16; // 16 = IV prefix
      decryptPacket(this.cipherIn, packetData, expectedPlainSize)
        .then((result) => this.processPacketData(header, result))
        .catch((err) =>
          this.protocolError("failed to decrypt data: " + err),
        );
      return true;
    }

    this.processPacketData(header, packetData);
    return true;
  }

  /**
   * Decompress (if needed), reassemble chunked packets, decode, and dispatch.
   */
  private processPacketData(header: number[], packetData: Uint8Array): void {
    const level = header[2];
    const index = header[3];

    // --- Decompression ---
    if (level !== CompressionLevel.NONE) {
      if (level & CompressionLevel.LZ4) {
        packetData = xpraLz4Decode(packetData);
      } else if (level & CompressionLevel.BROTLI) {
        if (!brotliDecompress) {
          this.protocolError(
            "received Brotli-compressed packet but brotli-wasm is not loaded",
          );
          return;
        }
        packetData = brotliDecompress(packetData);
      } else {
        this.protocolError(`unsupported compressor: 0x${level.toString(16)}`);
        return;
      }
    }

    // --- Chunked (raw) packets ---
    if (index > 0) {
      if (index >= 20) {
        this.protocolError(`invalid packet index: ${index}`);
        return;
      }
      this.rawPackets[index] = packetData;
      if (Object.keys(this.rawPackets).length >= 4) {
        this.protocolError(
          `too many raw packets: ${Object.keys(this.rawPackets).length}`,
        );
      }
      return;
    }

    // --- Decode ---
    let packet: any;
    try {
      packet = rdecode(packetData);
      for (const rawIdx in this.rawPackets) {
        packet[rawIdx] = this.rawPackets[rawIdx];
      }
      this.rawPackets = {};
    } catch (err) {
      logError("error decoding packet:", err);
      logError("packet data:", packetData);
      logError("protocol flags:", header[1], "level:", level, "index:", index);
      this.rawPackets = {};
      return;
    }

    try {
      this.emit(packet as ServerPacket);
    } catch (err) {
      logError(`error processing packet ${packet[0]}:`, err);
    }
  }

  // -----------------------------------------------------------------------
  // Send path
  // -----------------------------------------------------------------------

  private processSendQueue(): void {
    while (this.sQ.length > 0 && this.ws) {
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

      if (this.cipherOut) {
        encryptPacket(this.cipherOut, bdata)
          .then((combined) => {
            this.sendFrame(combined, payloadSize + 16, true);
          })
          .catch((err) =>
            this.protocolError("failed to encrypt packet: " + err),
          );
        return;
      }

      this.sendFrame(bdata, payloadSize, false);
    }
  }

  private makePacketHeader(
    protoFlags: number,
    level: number,
    payloadSize: number,
  ): Uint8Array {
    const header = new Uint8Array(HEADER_SIZE);
    header[0] = HEADER_MAGIC;
    header[1] = protoFlags;
    header[2] = level;
    header[3] = 0;
    header[4] = (payloadSize >>> 24) & 0xff;
    header[5] = (payloadSize >>> 16) & 0xff;
    header[6] = (payloadSize >>> 8) & 0xff;
    header[7] = payloadSize & 0xff;
    return header;
  }

  private sendFrame(
    bdata: Uint8Array,
    payloadSize: number,
    encrypted: boolean,
  ): void {
    let protoFlags = ProtoFlags.RENCODEPLUS;
    if (encrypted) {
      protoFlags |= ProtoFlags.ENCRYPTED;
    }
    const header = this.makePacketHeader(protoFlags, 0, payloadSize);
    const frame = new Uint8Array(HEADER_SIZE + bdata.byteLength);
    frame.set(header, 0);
    frame.set(bdata, HEADER_SIZE);
    if (this.ws) {
      this.ws.send(frame.buffer);
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

  private closeSocket(): void {
    this.clearConnectTimer();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private protocolError(message: string): void {
    logError("protocol error:", message);
    this.closeSocket();
    this.header = [];
    this.rQ = [];
    this.emit(["close", message] as ServerPacket);
  }
}

// ---------------------------------------------------------------------------
// Utility: human-readable close event description
// ---------------------------------------------------------------------------

function closeEventStr(event: CloseEvent | { code?: number; reason?: string }): string {
  if (!event.code) {
    return "unknown reason (no websocket error code)";
  }
  try {
    const desc = WS_CLOSE_CODES[event.code];
    let msg = desc !== undefined ? `'${desc}' (${event.code})` : `${event.code}`;
    if (event.reason) {
      msg += `: '${event.reason}'`;
    }
    return msg;
  } catch {
    return "unknown reason";
  }
}
