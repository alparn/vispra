/*
 * Clipboard handling for Xpra HTML5 client.
 * Ported from Client.js clipboard logic.
 *
 * Licensed under MPL 2.0
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { StringToUint8, Uint8ToString, trimString } from "@/core/utils/encoding";
import type {
  ClipboardRequestPacket,
  ClipboardTokenPacket,
  ClientPacket,
  SetClipboardEnabledPacket,
} from "@/core/protocol/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEXT_PLAIN = "text/plain";
export const UTF8_STRING = "UTF8_STRING";
export const TEXT_HTML = "text/html";

export const CLIPBOARD_IMAGES = true;
export const CLIPBOARD_EVENT_DELAY = 100;

// ---------------------------------------------------------------------------
// Server buffer: [target, dtype, dformat, wire_encoding, wire_data]
// ---------------------------------------------------------------------------

export type ClipboardServerBuffer = [
  string | null,  // target
  string | null,  // dtype
  number | null,  // dformat
  string | null,  // wire_encoding
  string | Uint8Array | null,  // wire_data
];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ClipboardOptions {
  /** Whether clipboard sync is enabled */
  enabled: boolean;
  /** Whether to poll clipboard (for browsers without paste event access) */
  poll: boolean;
  /** Preferred format: text/plain, text/html, UTF8_STRING */
  preferredFormat: string;
  /** Supported targets (set by capabilities) */
  targets: string[];
  /** Pasteboard element (hidden textarea for copy/cut) - selector or element */
  pasteboard: string | HTMLTextAreaElement;
  /** Element to attach click/keypress for maySetClipboard - selector or element */
  screenElement?: string | HTMLElement;
  /** Callback to send packets to server */
  onSend: (packet: ClientPacket) => void;
  /** Callback when user pastes files (for file transfer) */
  onSendFile?: (file: File) => void;
  /** Check if connected */
  isConnected: () => boolean;
  /** Fallback: type text as keystrokes when clipboard-token isn't consumed */
  onTypeText?: (text: string) => void;
  /** Debug logger */
  debug?: (category: string, ...args: unknown[]) => void;
  /** Log logger */
  log?: (...args: unknown[]) => void;
}

function truncateForLog(input: unknown): string {
  if (input == null) return String(input);
  const s = String(input);
  return trimString(s, 20);
}

// ---------------------------------------------------------------------------
// ClipboardManager
// ---------------------------------------------------------------------------

export class ClipboardManager {
  private options: ClipboardOptions;
  private clipboardBuffer = "";
  private clipboardDatatype: string | null = null;
  private clipboardPending = false;
  private clipboardServerBuffers: Record<string, ClipboardServerBuffer> = {};
  private _enabled: boolean;
  private pasteboardEl: HTMLTextAreaElement | null = null;
  private screenEl: HTMLElement | null = null;
  private boundPaste: (e: ClipboardEvent) => void;
  private boundCopy: (e: ClipboardEvent) => void;
  private boundCut: (e: ClipboardEvent) => void;
  private boundMaySetClipboard: () => void;
  private _suppressNextPaste = false;

  constructor(options: ClipboardOptions) {
    this.options = options;
    this._enabled = options.enabled;
    this.boundPaste = this.handlePaste.bind(this);
    this.boundCopy = this.handleCopy.bind(this);
    this.boundCut = this.handleCut.bind(this);
    this.boundMaySetClipboard = this.maySetClipboard.bind(this);
  }

  private cdebug(...args: unknown[]): void {
    this.options.debug?.("clipboard", ...args);
  }

  private clog(...args: unknown[]): void {
    this.options.log?.("clipboard:", ...args);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  getBuffer(): string {
    return this.clipboardBuffer;
  }

  getDatatype(): string | null {
    return this.clipboardDatatype;
  }

  getServerBuffers(): Record<string, ClipboardServerBuffer> {
    return this.clipboardServerBuffers;
  }

  get delayedEventTime(): number {
    return 0; // Used by keyboard for CLIPBOARD_EVENT_DELAY - managed externally
  }

  /** Initialize clipboard: add event listeners */
  init(): void {
    this.clog(
      "initializing clipboard: enabled=",
      this._enabled,
      ", poll=",
      this.options.poll,
      ", preferred format=",
      this.options.preferredFormat,
    );
    if (!this._enabled) return;

    const pasteboard =
      typeof this.options.pasteboard === "string"
        ? document.querySelector<HTMLTextAreaElement>(this.options.pasteboard)
        : this.options.pasteboard;
    this.pasteboardEl = pasteboard;

    const screen =
      this.options.screenElement != null
        ? typeof this.options.screenElement === "string"
          ? document.querySelector<HTMLElement>(this.options.screenElement)
          : this.options.screenElement
        : document.getElementById("screen") ?? document.body;
    this.screenEl = screen;

    window.addEventListener("paste", this.boundPaste);
    window.addEventListener("copy", this.boundCopy);
    window.addEventListener("cut", this.boundCut);
    if (this.screenEl) {
      this.screenEl.addEventListener("click", this.boundMaySetClipboard);
      this.screenEl.addEventListener("keypress", this.boundMaySetClipboard);
    }
  }

  /** Remove event listeners */
  destroy(): void {
    window.removeEventListener("paste", this.boundPaste);
    window.removeEventListener("copy", this.boundCopy);
    window.removeEventListener("cut", this.boundCut);
    if (this.screenEl) {
      this.screenEl.removeEventListener("click", this.boundMaySetClipboard);
      this.screenEl.removeEventListener("keypress", this.boundMaySetClipboard);
    }
    this.pasteboardEl = null;
    this.screenEl = null;
  }

  private handlePaste(e: ClipboardEvent): void {
    if (this._suppressNextPaste) {
      this._suppressNextPaste = false;
      return;
    }

    const clipboardData = e.clipboardData;
    if (clipboardData?.files && clipboardData.files.length > 0) {
      const files = clipboardData.files;
      this.clog("paste got", files.length, "files");
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i);
        if (file) this.options.onSendFile?.(file);
      }
      e.preventDefault();
      return;
    }

    const fmt = this.options.preferredFormat;
    if (
      (fmt === TEXT_PLAIN || fmt === UTF8_STRING) &&
      navigator.clipboard?.readText
    ) {
      navigator.clipboard.readText().then(
        (text) => {
          this.clipboardBuffer = text;
          const data = StringToUint8(text);
          this.sendClipboardToken(data);
        },
        (error) => {
          this.cdebug("paste event failed:", error);
        },
      );
      return;
    }

    if (clipboardData) {
      const clipboardBuffer = clipboardData.getData(fmt);
      if (clipboardBuffer) {
        this.cdebug("paste event, ", fmt, "=", clipboardBuffer);
        this.clipboardBuffer = clipboardBuffer;
        const data = StringToUint8(clipboardBuffer);
        this.sendClipboardToken(data, [fmt]);
      }
    }
  }

  private handleCopy(_e: ClipboardEvent): void {
    const clipboardBuffer = this.getBuffer();
    if (this.pasteboardEl) {
      this.pasteboardEl.value = clipboardBuffer;
      this.pasteboardEl.focus();
      this.pasteboardEl.select();
    }
    this.cdebug("copy event, clipboard buffer=", clipboardBuffer);
    this.clipboardPending = false;
  }

  private handleCut(_e: ClipboardEvent): void {
    const clipboardBuffer = this.getBuffer();
    if (this.pasteboardEl) {
      this.pasteboardEl.value = clipboardBuffer;
      this.pasteboardEl.focus();
      this.pasteboardEl.select();
    }
    this.cdebug("cut event, clipboard buffer=", clipboardBuffer);
    this.clipboardPending = false;
  }

  maySetClipboard(): void {
    this.cdebug(
      "pending=",
      this.clipboardPending,
      "buffer=",
      truncateForLog(this.clipboardBuffer),
    );
    if (!this.clipboardPending) return;

    let clipboardBuffer = this.getBuffer();
    const clipboardDatatype = (this.getDatatype() ?? "").toLowerCase();
    const isText =
      clipboardDatatype.includes("text") || clipboardDatatype.includes("string");
    if (!isText) {
      clipboardBuffer = "";
    }

    if (this.pasteboardEl) {
      this.pasteboardEl.value = clipboardBuffer;
      this.pasteboardEl.focus();
      this.pasteboardEl.select();
    }
    this.cdebug(
      "click event, with pending clipboard datatype=",
      clipboardDatatype,
      ", buffer=",
      clipboardBuffer,
    );

    let success = false;
    const w = window as Window & { clipboardData?: { setData?: (t: string, d: string) => void } };
    if (
      Object.hasOwn(w, "clipboardData") &&
      w.clipboardData?.setData &&
      typeof w.clipboardData.setData === "function"
    ) {
      try {
        w.clipboardData.setData(clipboardDatatype, clipboardBuffer);
        success = true;
      } catch {
        success = false;
      }
    }
    if (!success && isText) {
      success = document.execCommand("copy");
    }
    if (success) {
      this.clipboardBuffer = clipboardBuffer;
      this.clipboardPending = false;
    }
  }

  /**
   * Suppress the next native paste event handler (handlePaste).
   * Called when preparePasteForServer already handles clipboard reading,
   * so the native paste event shouldn't send a duplicate clipboard-token.
   */
  suppressNextPaste(): void {
    this._suppressNextPaste = true;
  }

  /**
   * Proactively read and send clipboard on Ctrl+V (paste).
   * Called by keyboard controller on paste shortcut (user gesture).
   * Ensures the server receives clipboard content BEFORE key events,
   * which is critical for xterm and other applications.
   */
  preparePasteForServer(): void {
    if (!this._enabled || !this.options.isConnected()) return;
    this.readAndSendClipboard(false);
  }

  /**
   * Read clipboard and send to both CLIPBOARD and PRIMARY selections.
   * Used for terminal paste (Shift+Insert reads PRIMARY by default in XTerm).
   */
  preparePasteForTerminal(): void {
    if (!this._enabled || !this.options.isConnected()) return;
    this.readAndSendClipboard(true);
  }

  private readAndSendClipboard(alsoSetPrimary: boolean): void {
    const sendText = (text: string) => {
      this.clipboardBuffer = text;
      const data = StringToUint8(text);
      this.sendClipboardToken(data);
      if (alsoSetPrimary) {
        this.sendClipboardToken(data, undefined, "PRIMARY");
      }
    };

    const nav = navigator.clipboard;
    if (nav?.readText) {
      nav.readText().then(
        (text) => sendText(text),
        (error) => this.cdebug("readAndSendClipboard readText() failed:", error),
      );
      return;
    }

    if (nav && "read" in nav && typeof nav.read === "function") {
      nav.read().then(
        (items) => {
          for (const item of items) {
            if (item.types.includes(TEXT_PLAIN)) {
              item.getType(TEXT_PLAIN).then(
                (blob) => {
                  const reader = new FileReader();
                  reader.addEventListener("load", () => {
                    sendText(String(reader.result ?? ""));
                  });
                  reader.readAsText(blob);
                },
                (err) => this.cdebug("readAndSendClipboard getType failed:", err),
              );
              return;
            }
          }
        },
        (err) => this.cdebug("readAndSendClipboard read() failed:", err),
      );
    }
  }

  /** Called by keyboard/input when polling - returns true if clipboard changed */
  pollClipboard(e?: ClipboardEvent): boolean {
    if (!this.options.poll) return false;
    if (this.clipboardPending) return false;
    this.readClipboard(e);
    return false; // Caller uses CLIPBOARD_EVENT_DELAY
  }

  readClipboard(e?: ClipboardEvent): void {
    if (!this._enabled) return;

    const nav = navigator.clipboard;
    if (nav && "read" in nav && typeof nav.read === "function") {
      this.cdebug("polling using navigator.clipboard.read()");
      this.readClipboardData();
      return;
    }
    if (nav && "readText" in nav && typeof nav.readText === "function") {
      this.cdebug("polling using navigator.clipboard.readText");
      this.readClipboardText();
      return;
    }

    // Fallback: paste event data
    const clipboardData = e?.clipboardData;
    if (!clipboardData) {
      this.cdebug("polling: no data available");
      return;
    }
    const rawBuffer = clipboardData.getData(TEXT_PLAIN);
    if (rawBuffer == null) return;
    if (rawBuffer === this.clipboardBuffer) return;
    this.cdebug("clipboard contents have changed");
    this.clipboardBuffer = rawBuffer;
    this.sendClipboardToken(StringToUint8(rawBuffer), [TEXT_PLAIN]);
  }

  private readClipboardData(): void {
    if (!this._enabled) return;
    const nav = navigator.clipboard;
    if (!nav?.read) return;
    nav.read().then(
      (items) => {
        for (const item of items) {
          if (item.types.includes(TEXT_HTML)) {
            item.getType(TEXT_HTML).then(
              (blob) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                  const text = String(reader.result ?? "");
                  this.cdebug("paste event, text/html=", text);
                  if (text !== this.clipboardBuffer) {
                    this.cdebug("clipboard contents have changed");
                    this.clipboardBuffer = text;
                    this.sendClipboardToken(StringToUint8(text), [TEXT_HTML]);
                  }
                  this.clipboardPending = false;
                });
                reader.readAsText(blob);
              },
              (error) => {
                this.cdebug("paste event failed:", error);
                this.clipboardPending = false;
              },
            );
            return;
          }
        }
        this.readClipboardText();
      },
      (error) => {
        this.cdebug("read() failed:", error);
        this.clipboardPending = false;
      },
    );
  }

  private readClipboardText(): void {
    if (!this._enabled) return;
    this.cdebug("readClipboardText()");
    navigator.clipboard!.readText().then(
      (text) => {
        this.cdebug("paste event, text=", text);
        if (text !== this.clipboardBuffer) {
          this.cdebug("clipboard contents have changed");
          this.clipboardBuffer = text;
          this.sendClipboardToken(StringToUint8(text));
        }
        this.clipboardPending = false;
      },
      (error) => {
        this.cdebug("paste event failed:", error);
        this.clipboardPending = false;
      },
    );
  }

  // -------------------------------------------------------------------------
  // Send to server
  // -------------------------------------------------------------------------

  sendClipboardToken(data: Uint8Array | string, dataFormat?: string[], selection?: string): void {
    const sel = selection ?? "CLIPBOARD";
    if (!this._enabled || !this.options.isConnected()) return;

    const claim = true;
    const greedy = true;
    const synchronous = true;
    let actualDataFormat = dataFormat;
    if (!actualDataFormat) {
      actualDataFormat =
        this.options.preferredFormat === UTF8_STRING
          ? [UTF8_STRING, TEXT_PLAIN]
          : [TEXT_PLAIN, UTF8_STRING];
    }

    this.cdebug("sending clipboard token with data:", data, "as", actualDataFormat, "selection=", sel);

    const packet: ClientPacket = data
      ? ([
          PACKET_TYPES.clipboard_token,
          sel,
          actualDataFormat,
          UTF8_STRING,
          UTF8_STRING,
          8,
          "bytes",
          data,
          claim,
          greedy,
          synchronous,
        ] as ClientPacket)
      : ([
          PACKET_TYPES.clipboard_token,
          sel,
          [],
          "",
          "",
          8,
          "bytes",
          "",
          claim,
          greedy,
          synchronous,
        ] as ClientPacket);
    this.options.onSend(packet);
  }

  sendClipboardNone(requestId: number, selection: string): void {
    const packet: ClientPacket = [
      PACKET_TYPES.clipboard_contents_none,
      requestId,
      selection,
    ];
    this.cdebug("sending clipboard-contents-none");
    this.options.onSend(packet);
  }

  sendClipboardString(
    requestId: number,
    selection: string,
    clipboardBuffer: string,
    datatype?: string,
  ): void {
    if (clipboardBuffer === "") {
      this.sendClipboardNone(requestId, selection);
      return;
    }
    const packet: ClientPacket = [
      PACKET_TYPES.clipboard_contents,
      requestId,
      selection,
      datatype ?? UTF8_STRING,
      8,
      "bytes",
      clipboardBuffer,
    ];
    this.cdebug("send_clipboard_string: packet=", packet);
    this.options.onSend(packet);
  }

  sendClipboardContents(
    requestId: number,
    selection: string,
    datatype: string,
    dformat: number,
    encoding: string,
    clipboardBuffer: string | Uint8Array,
  ): void {
    if (clipboardBuffer === "" || (clipboardBuffer instanceof Uint8Array && clipboardBuffer.length === 0)) {
      this.sendClipboardNone(requestId, selection);
      return;
    }
    const packet: ClientPacket = [
      PACKET_TYPES.clipboard_contents,
      requestId,
      selection,
      datatype,
      dformat || 8,
      encoding || "bytes",
      clipboardBuffer,
    ];
    this.options.onSend(packet);
  }

  resendClipboardServerBuffer(
    requestId?: number,
    selection?: string,
  ): void {
    const reqId = requestId ?? 0;
    const sel = selection ?? "CLIPBOARD";
    const serverBuffer = this.clipboardServerBuffers["CLIPBOARD"];
    this.cdebug("resend_clipboard_server_buffer:", serverBuffer);
    if (!serverBuffer) {
      this.sendClipboardString(reqId, sel, "", UTF8_STRING);
      return;
    }
    const [, dtype, dformat, wireEncoding, wireData] = serverBuffer;
    this.sendClipboardContents(
      reqId,
      sel,
      dtype ?? "",
      dformat ?? 8,
      wireEncoding ?? "bytes",
      wireData ?? "",
    );
  }

  // -------------------------------------------------------------------------
  // Process packets from server
  // -------------------------------------------------------------------------

  processClipboardToken(packet: ClipboardTokenPacket): void {
    if (!this._enabled) return;

    const selection = packet[1];
    let target: string | null = null;
    let dtype: string | null = null;
    let dformat: number | null = null;
    let wireEncoding: string | null = null;
    let wireData: Uint8Array | string | null = null;

    if (packet.length >= 8) {
      target = packet[3] as string | null;
      dtype = packet[4] as string | null;
      dformat = packet[5] as number | null;
      wireEncoding = packet[6] as string | null;
      wireData = packet[7] as Uint8Array | string | null;
      this.clipboardServerBuffers[selection] = [
        target,
        dtype,
        dformat,
        wireEncoding,
        wireData,
      ];
    }

    const isValidTarget =
      target != null && this.options.targets.includes(target);

    if (!isValidTarget) return;

    const isText =
      (dtype ?? "").toLowerCase().includes("text") ||
      (dtype ?? "").toLowerCase().includes("string");

    if (isText) {
      try {
        const str =
          wireData instanceof Uint8Array ? Uint8ToString(wireData) : wireData ?? "";
        const changed = this.clipboardBuffer !== str;
        if (changed) {
          this.clipboardDatatype = dtype;
          this.clipboardBuffer = str;
          this.clipboardPending = true;
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(str).then(
              () => { this.clipboardPending = false; },
              (err) => this.cdebug("writeText to browser clipboard failed:", err),
            );
          }
        }
      } catch (e) {
        this.cdebug("processClipboardToken TEXT exception:", e);
      }
      return;
    }

    if (
      CLIPBOARD_IMAGES &&
      dtype === "image/png" &&
      dformat === 8 &&
      wireEncoding === "bytes" &&
      Object.hasOwn(navigator.clipboard ?? {}, "write")
    ) {
      this.cdebug("png image received");
      const data =
        wireData instanceof Uint8Array ? wireData : new Uint8Array(0);
      const buffer =
        data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? data.buffer
          : data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            );
      const blob = new Blob([buffer as ArrayBuffer], { type: dtype });
      const item = new ClipboardItem({ "image/png": blob });
      navigator.clipboard!.write([item]).then(
        () => this.cdebug("copied png image to clipboard"),
        (error) => this.cdebug("failed to set png image", error),
      );
    }
  }

  processSetClipboardEnabled(packet: SetClipboardEnabledPacket): void {
    if (!this._enabled) return;
    this._enabled = packet[1];
    this.options.log?.(
      "server set clipboard state to",
      packet[1],
      "reason was:",
      packet[2],
    );
  }

  processClipboardRequest(packet: ClipboardRequestPacket): void {
    const requestId = packet[1];
    const selection = packet[2];

    if (selection !== "CLIPBOARD") {
      this.sendClipboardString(requestId, selection, "");
      return;
    }

    if (navigator.clipboard) {
      if (Object.hasOwn(navigator.clipboard, "read")) {
        navigator.clipboard.read().then(
          (data) => {
            this.cdebug("request via read() data=", data);
            for (let i = 0; i < data.length; i++) {
              const item = data[i];
              this.cdebug("item", i, "types:", item.types);
              for (const itemType of item.types) {
                if (itemType === TEXT_PLAIN) {
                  item.getType(itemType).then(
                    (blob) => {
                      const reader = new FileReader();
                      reader.addEventListener("load", () =>
                        this.sendClipboardString(
                          requestId,
                          selection,
                          String(reader.result),
                        ),
                      );
                      reader.readAsText(blob);
                    },
                    () => {
                      this.cdebug(`getType('${itemType}') failed`);
                      this.resendClipboardServerBuffer(requestId, selection);
                    },
                  );
                  return;
                }
                if (itemType === "image/png") {
                  item.getType(itemType).then(
                    (blob) => {
                      const reader = new FileReader();
                      reader.addEventListener("load", () => {
                        const result = reader.result;
                        const buf =
                          result instanceof ArrayBuffer
                            ? new Uint8Array(result)
                            : new Uint8Array(0);
                        this.sendClipboardContents(
                          requestId,
                          selection,
                          itemType,
                          8,
                          "bytes",
                          buf,
                        );
                      });
                      reader.readAsArrayBuffer(blob);
                    },
                    () => {
                      this.cdebug(`getType('${itemType}') failed`);
                      this.resendClipboardServerBuffer(requestId, selection);
                    },
                  );
                  return;
                }
              }
            }
          },
          () => {
            this.cdebug("read() failed");
            this.resendClipboardServerBuffer(requestId, selection);
          },
        );
        return;
      }
      if (Object.hasOwn(navigator.clipboard, "readText")) {
        this.cdebug("clipboard request using readText()");
        navigator.clipboard.readText().then(
          (text) => {
            this.cdebug("clipboard request via readText() text=", text);
            const primaryBuffer = this.clipboardServerBuffers["PRIMARY"];
            if (
              primaryBuffer &&
              primaryBuffer[2] === 8 &&
              primaryBuffer[3] === "bytes"
            ) {
              const primaryData = primaryBuffer[4];
              const primaryStr =
                primaryData instanceof Uint8Array
                  ? Uint8ToString(primaryData)
                  : primaryData ?? "";
              if (text === primaryStr) {
                this.cdebug("clipboard request: using backup value");
                this.resendClipboardServerBuffer(requestId, selection);
                return;
              }
            }
            this.sendClipboardString(requestId, selection, text);
          },
          () => {
            this.cdebug("readText() failed");
            this.resendClipboardServerBuffer(requestId, selection);
          },
        );
        return;
      }
    }

    const clipboardBuffer = this.getBuffer() ?? "";
    this.sendClipboardString(requestId, selection, clipboardBuffer, UTF8_STRING);
  }
}
