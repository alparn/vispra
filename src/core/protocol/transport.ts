/*
 * Author: Ali Parnan
 */

import type {
  CipherCaps,
  ClientPacket,
  PacketHandler,
} from "./types";

// ---------------------------------------------------------------------------
// ProtocolTransport — common interface for WebSocket & WebTransport backends
// ---------------------------------------------------------------------------

/**
 * Abstraction over the Xpra wire protocol transport.
 *
 * Both the WebSocket-based `XpraProtocol` and the `XpraWebTransportProtocol`
 * implement this interface so the client orchestrator (`XpraClient`) can be
 * transport-agnostic.
 *
 * Lifecycle: `open()` → packets flow → `close()`.
 *
 * The transport is responsible for:
 *  - encoding/decoding packets (rencode / rencodeplus)
 *  - compressing/decompressing payloads (LZ4 / Brotli)
 *  - optional AES encryption/decryption
 *  - framing via the 8-byte Xpra wire header
 */
export interface ProtocolTransport {
  /**
   * Open the connection to the given URI.
   *
   * The transport emits synthetic packets to the registered handler:
   *  - `["open"]` when the connection is established
   *  - `["error", message, code]` on connection errors
   *  - `["close", reason]` when the connection is closed
   *
   * May be called again after `close()` to reconnect (same URI or different).
   */
  open(uri: string): void;

  /**
   * Gracefully close the connection.
   * After calling this, no more packets will be delivered to the handler.
   */
  close(): void;

  /**
   * Queue a packet for sending.
   * The transport encodes, optionally compresses, optionally encrypts,
   * frames, and sends the packet asynchronously.
   */
  send(packet: ClientPacket): void;

  /**
   * Register the callback that receives all incoming (decoded) packets.
   * This includes both real server packets and synthetic transport events
   * (`open`, `close`, `error`).
   *
   * Only one handler can be active at a time; calling this again replaces
   * the previous handler.
   */
  setPacketHandler(handler: PacketHandler): void;

  /**
   * Configure inbound decryption (server → client).
   * Must be called after receiving encryption capabilities in the
   * server hello or challenge packet.
   *
   * @throws if the cipher/mode/params are unsupported
   */
  setCipherIn(caps: CipherCaps, key: string): void;

  /**
   * Configure outbound encryption (client → server).
   * Must be called before sending the hello response when encryption
   * is negotiated.
   *
   * @throws if the cipher/mode/params are unsupported
   */
  setCipherOut(caps: CipherCaps, key: string): void;
}

// ---------------------------------------------------------------------------
// ProtocolTransport with worker delegation
// ---------------------------------------------------------------------------

/**
 * Extended transport interface for implementations that delegate to a
 * Web Worker (e.g. `XpraProtocolWorkerHost`).
 */
export interface WorkerProtocolTransport extends ProtocolTransport {
  /** Terminate the underlying worker process. */
  terminate(): void;
}

// ---------------------------------------------------------------------------
// Transport factory helper type
// ---------------------------------------------------------------------------

export type TransportKind = "websocket" | "webtransport" | "worker";

/**
 * Creates the appropriate `ProtocolTransport` for the requested kind.
 * Useful for the client orchestrator to pick the right backend at connect time.
 */
export type TransportFactory = (kind: TransportKind) => ProtocolTransport;
