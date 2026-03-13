/*
 * Author: Ali Parnan
 *
 * XpraClient Orchestrator — Phase 7c.
 *
 * Thin orchestrator (~250 lines) that wires transport, packet handlers,
 * capability builder, and Solid.js stores. Replaces the monolithic
 * Client.js (4.912 lines, ~200 methods) with a delegation pattern.
 */

import type { ProtocolTransport } from "@/core/protocol/transport";
import type { Capabilities, ClientPacket, ServerPacket } from "@/core/protocol/types";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import { XpraWebSocketTransport } from "@/core/protocol/websocket";
import { XpraProtocolWorkerHost } from "@/core/protocol/worker-host";
import { getHexUUID, gendigest, getSecureRandomString, xor } from "@/core/utils/crypto";
import { Uint8ToString } from "@/core/utils/encoding";
import { isSafeHost } from "@/core/utils/storage";
import { log, warn, error as logError, debug as logDebug } from "@/core/utils/logging";
import { packetHandlers } from "@/core/handlers";
import type { HandlerContext } from "@/core/handlers/types";
import { makeHello, type CapabilitiesBuilderInput, type EncodingOptions } from "@/core/capabilities/builder";
import { getDPI, getScreenSizes, getMonitors } from "@/core/capabilities/display";
import { connectionStore, setConnecting, setDisconnected } from "@/store/connection";
import { windowsStore } from "@/store/windows";
import { settingsStore } from "@/store/settings";
import { WindowRenderer } from "@/window/renderer";
import { getWindowCanvas } from "@/store/window-canvases";
import type { DrawPacket } from "@/core/codec/rgb-helpers";
import type { DecodeWorkerOutbound } from "@/core/codec/decode-worker-types";
import {
  registerPacketSender,
  unregisterPacketSender,
  registerRendererResizer,
  unregisterRendererResizer,
  registerDisplayConfigurator,
  unregisterDisplayConfigurator,
} from "@/store/client-bridge";
import { KeyboardController } from "@/core/input/keyboard";
import { parse_modifiers, parse_server_modifiers } from "@/core/keycodes/modifiers";
import { MouseHandler, type MouseWindow, type MouseEventLike } from "@/core/input/mouse";
import { ClipboardManager, UTF8_STRING } from "@/core/features/clipboard";
import { AudioManager } from "@/core/features/audio";
import {
  enableAudio,
  setAudioPlaybackState,
  setAudioCodecList,
  setActiveAudioFramework,
  setActiveAudioCodec,
  setAudioBackendFlags,
  resetAudio,
} from "@/store/audio";
import { focusedWid, getFocusedAppHint, windows } from "@/store/windows";
import {
  registerMouseForwarder,
  unregisterMouseForwarder,
} from "@/store/client-bridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectOptions {
  host: string;
  port: number;
  path?: string;
  ssl?: boolean;
  webTransport?: boolean;
  username?: string;
  passwords?: string[];
  encryptionKey?: string;
  container?: HTMLElement;
  startNewSession?: string | null;
  sharing?: boolean;
  steal?: boolean;
  reconnect?: boolean;
}

export interface XpraClientCallbacks {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onProgress?: (state: string, details: string, progress: number) => void;
  onNewWindow?: (wid: number, x: number, y: number, w: number, h: number, metadata: Record<string, unknown>, clientProps: Record<string, unknown>) => void;
  onLostWindow?: (wid: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HELLO_TIMEOUT = 30_000;
const PING_FREQUENCY = 5_000;

// ---------------------------------------------------------------------------
// XpraClient
// ---------------------------------------------------------------------------

export class XpraClient {
  private transport: ProtocolTransport | null = null;
  private uri = "";
  private options: ConnectOptions = {} as ConnectOptions;
  private callbacks: XpraClientCallbacks = {};
  private uuid = getHexUUID();
  private helloTimer = 0;
  private pingTimer = 0;
  private container: HTMLElement | null = null;
  private decodeWorker: Worker | null = null;
  private renderers = new Map<number, WindowRenderer>();
  private rafId = 0;
  private keyboardController: KeyboardController | null = null;
  private clipboardManager: ClipboardManager | null = null;
  private mouseHandler: MouseHandler | null = null;
  private audioManager: AudioManager | null = null;
  private serverPreciseWheel = false;
  private resizeHandler: (() => void) | null = null;
  private resizeDebounceTimer = 0;

  constructor(callbacks: XpraClientCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  connect(options: ConnectOptions): void {
    settingsStore.loadSettingsFromParams();
    if (options.reconnect !== undefined) {
      settingsStore.updateSettings({ reconnect: options.reconnect });
    }
    this.options = options;
    this.uri = this.buildUri(options);
    this.container = options.container ?? document.getElementById("screen");

    setConnecting();
    connectionStore.setProgress({ state: "Initializing", details: "", progress: 20 });
    this.callbacks.onProgress?.("Initializing", "", 20);

    connectionStore.setProgress({ state: "Connecting to server", details: this.uri, progress: 30 });
    this.callbacks.onProgress?.("Connecting to server", this.uri, 30);

    const useWorker = typeof Worker !== "undefined" && !options.webTransport;
    this.transport = useWorker
      ? new XpraProtocolWorkerHost()
      : new XpraWebSocketTransport();

    this.transport.setPacketHandler((p) => this.routePacket(p));

    connectionStore.setProgress({ state: "Opening WebSocket connection", details: this.uri, progress: 50 });
    this.callbacks.onProgress?.("Opening WebSocket connection", this.uri, 50);
    this.transport.open(this.uri);

    registerPacketSender((p) => this.send(p));
    registerRendererResizer((wid, w, h) => this.resizeRendererCanvas(wid, w, h));
    registerDisplayConfigurator(() => this.sendConfigureDisplay());
    this.initAudio();
    this.initDecodeWorker();
    this.startRenderLoop();

    this.helloTimer = window.setTimeout(
      () => this.disconnect("hello timeout"),
      HELLO_TIMEOUT,
    );
  }

  disconnect(reason?: string): void {
    this.stopResizeListener();
    unregisterPacketSender();
    unregisterRendererResizer();
    unregisterDisplayConfigurator();
    unregisterMouseForwarder();
    if (this.mouseHandler) this.mouseHandler = null;
    if (this.audioManager) {
      this.audioManager.destroy();
      this.audioManager = null;
      resetAudio();
    }
    if (this.clipboardManager) {
      this.clipboardManager.destroy();
      this.clipboardManager = null;
    }
    if (this.keyboardController) {
      this.keyboardController.destroy();
      this.keyboardController = null;
    }
    this.clearTimers();
    this.stopRenderLoop();
    if (this.decodeWorker) {
      this.decodeWorker.postMessage({ c: "close" });
      this.decodeWorker.terminate();
      this.decodeWorker = null;
    }
    this.renderers.clear();
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    windowsStore.clear();
    setDisconnected(reason ?? null);
    this.callbacks.onDisconnect?.(reason ?? "disconnected");
  }

  send(packet: ClientPacket): void {
    this.transport?.send(packet);
  }

  // -----------------------------------------------------------------------
  // Packet routing — delegates to modular handlers from Phase 7a
  // -----------------------------------------------------------------------

  private routePacket(packet: ServerPacket): void {
    const type = packet[0];
    const handler = packetHandlers[type];
    if (handler) {
      try {
        handler(packet, this.handlerContext);
      } catch (err) {
        logError("packet handler error:", type, err);
      }
    } else {
      logDebug("unhandled packet type:", type);
    }
  }

  // -----------------------------------------------------------------------
  // HandlerContext — bridge between modular handlers and stores/transport
  // -----------------------------------------------------------------------

  private get handlerContext(): HandlerContext {
    return {
      send: (p: ClientPacket) => this.send(p),
      clipboardManager: this.clipboardManager ?? undefined,
      decodeWorker: this.decodeWorker ?? undefined,
      processDraw: (packet: unknown, start: number) =>
        this.processDraw(packet as DrawPacket, start),
      connectionStore: {
        setConnecting: () => connectionStore.setConnecting(),
        setConnected: (info: Record<string, unknown>) =>
          connectionStore.setConnected(info as Capabilities),
        setDisconnected: (reason: string | null) =>
          connectionStore.setDisconnected(reason),
        setError: (reason: string) => connectionStore.setError(reason),
        setReconnecting: () => connectionStore.setReconnecting(),
        incrementReconnectAttempt: () =>
          connectionStore.setReconnectAttemptCount(connectionStore.reconnectAttempt + 1),
        setProgress: (value) => connectionStore.setProgress(value),
        updateServerInfo: (updates) =>
          connectionStore.updateServerInfo(updates as Partial<import("@/store/connection").ServerInfo>),
        setDesktopSize: (w, h) => connectionStore.setDesktopSize(w, h),
        connected: () => connectionStore.isConnected(),
        reconnectInProgress: () => connectionStore.reconnectInProgress,
        reconnectAttempt: () => connectionStore.reconnectAttempt,
      },
      windowsStore: {
        addWindow: (wid, x, y, w, h, metadata, overrideRedirect, tray, clientProps) =>
          windowsStore.addWindow(wid, x, y, w, h, metadata, overrideRedirect, tray, clientProps),
        removeWindow: (wid) => windowsStore.removeWindow(wid),
        updateWindowMetadata: (wid, metadata) =>
          windowsStore.updateWindowMetadata(wid, metadata),
        updateWindow: (wid, updates) => windowsStore.updateWindow(wid, updates),
        setFocusedWindow: (wid) => windowsStore.setFocusedWindow(wid),
        clearAllWindows: () => windowsStore.clearAllWindows(),
        getWindow: (wid) => windowsStore.getWindow(wid),
        getWindowCount: () => windowsStore.getWindowCount(),
      },
      desktopWidth: this.container?.clientWidth || window.innerWidth || 1024,
      desktopHeight: this.container?.clientHeight || window.innerHeight || 768,
      log: (...args: unknown[]) => log(...args),
      warn: (...args: unknown[]) => warn(...args),
      error: (...args: unknown[]) => logError(...args),
      debug: (cat: string, ...args: unknown[]) => logDebug(cat, ...args),

      // Connection lifecycle callbacks
      onOpen: () => this.onOpen(),
      onClose: (reason: string) => this.disconnect(reason),
      onError: (reason: string) => this.disconnect(reason),
      onDisconnect: (reason: string) => this.disconnect(reason),
      onHello: (hello: Record<string, unknown>) => this.onHello(hello),
      onChallenge: (packet: unknown) => this.onChallenge(packet),
      onConnectionEstablished: () => this.callbacks.onConnect?.(),
      onStartupComplete: () => this.callbacks.onConnect?.(),
      onConnectionProgress: (state, details, progress) =>
        this.callbacks.onProgress?.(state, details, progress),

      // Window lifecycle callbacks
      onNewWindow: (wid, x, y, w, h, metadata, clientProps) => {
        console.log(
          "[xpra-display] new-window wid=%d pos=%d,%d size=%dx%d title=%s",
          wid, x, y, w, h, metadata?.["title"] ?? "(none)",
        );
        this.ensureRenderer(wid, w, h, metadata);
        this.callbacks.onNewWindow?.(wid, x, y, w, h, metadata, clientProps);

        const isDeskWin = Boolean(metadata?.["desktop"]) || Boolean(metadata?.["shadow"]);
        if (isDeskWin) {
          console.log("[xpra-display] desktop window detected → sending configure_display + buffer_refresh");
          this.sendConfigureDisplay();
          this.sendBufferRefresh(wid);
        }
      },
      onLostWindow: (wid) => {
        this.renderers.delete(wid);
        this.decodeWorker?.postMessage({ c: "remove", wid });
        this.callbacks.onLostWindow?.(wid);
      },
      onWindowResized: (wid, width, height) => {
        console.log("[xpra-display] window-resized wid=%d → %dx%d", wid, width, height);
        this.resizeRendererCanvas(wid, width, height);
        this.sendBufferRefresh(wid);
      },
      onWindowMoveResize: (wid, _x, _y, width, height) => {
        this.resizeRendererCanvas(wid, width, height);
        this.sendBufferRefresh(wid);
      },
      onConfigureOverrideRedirect: (wid, _x, _y, width, height) => {
        this.resizeRendererCanvas(wid, width, height);
      },

      // Audio
      processSoundData: (packet: unknown) => {
        if (!this.audioManager) return;
        const p = packet as [string, string, Uint8Array, Record<string, unknown>, Record<string, unknown>];
        const codec = typeof p[1] === "string" ? p[1] : String(p[1]);
        const buf = p[2];
        const options = (p[3] ?? {}) as Record<string, unknown>;
        const metadata = (p[4] ?? null) as Record<string, unknown> | null;
        this.audioManager.processSoundData(codec, buf, options, metadata);
      },
      closeAudio: () => {
        this.audioManager?.close();
      },
      playBell: (percent: number, pitch: number, duration: number) => {
        this.audioManager?.playBell(percent, pitch, duration);
      },

      resetCursor: () => {
        this.setCanvasCursor("default");
      },
      setCursorForAllWindows: (_encoding: string, w: number, h: number, xhot: number, yhot: number, imgData: Uint8Array) => {
        const blob = new Blob([imgData as unknown as BlobPart], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx2d = canvas.getContext("2d");
          if (!ctx2d) { URL.revokeObjectURL(url); return; }
          ctx2d.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL("image/png");
          this.setCanvasCursor(`url(${dataUrl}) ${xhot} ${yhot}, auto`);
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
      },
    };
  }

  private setCanvasCursor(cursor: string): void {
    const canvases = document.querySelectorAll<HTMLCanvasElement>(".window-canvas");
    canvases.forEach((c) => { c.style.cursor = cursor; });
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  private onOpen(): void {
    window.clearTimeout(this.helloTimer);
    this.sendHello();
  }

  private onHello(hello: Record<string, unknown>): void {
    if (hello["encryption"] && this.transport && this.options.encryptionKey) {
      this.transport.setCipherOut(
        hello["encryption"] as Parameters<ProtocolTransport["setCipherOut"]>[0],
        this.options.encryptionKey,
      );
    }

    const sessionName = String(hello["session_name"] ?? "");
    const w = this.container?.clientWidth || window.innerWidth || 1024;
    const h = this.container?.clientHeight || window.innerHeight || 768;
    console.log(
      "[xpra-display] onHello: server desktop=%sx%s, actual_desktop_size=%s, container=%dx%d, resolved=%dx%d",
      hello["desktop_size"], hello["actual_desktop_size"],
      JSON.stringify(hello["screen-sizes"]),
      this.container?.clientWidth, this.container?.clientHeight,
      w, h,
    );

    connectionStore.setSessionInfo(sessionName, w, h);
    connectionStore.updateServerInfo({
      display: String(hello["display"] ?? ""),
      platform: String(hello["platform"] ?? ""),
      resizeExact: Boolean(hello["resize_exact"]),
      screenSizes: (hello["screen-sizes"] as unknown[]) ?? [],
      isDesktop: Boolean(hello["desktop"]),
      isShadow: Boolean(hello["shadow"]),
      readonly: Boolean(hello["readonly"]),
      remoteLogging: Boolean(hello["remote-logging.multi-line"]),
      startTime: Number(hello["start_time"] ?? -1),
      connectionData: Boolean(hello["connection-data"]),
    });

    const clipboardInfo = {
      clipboard: hello["clipboard"],
      clipboard_enabled: hello["clipboard.enabled"],
      clipboard_direction: hello["clipboard.direction"],
      clipboard_selections: hello["clipboard.selections"],
      clipboard_want_targets: hello["clipboard.want_targets"],
      clipboard_greedy: hello["clipboard.greedy"],
    };
    console.log("[xpra-hello] Server clipboard capabilities:", JSON.stringify(clipboardInfo));
    console.log("[xpra-hello] wheel.precise=", hello["wheel.precise"]);
    connectionStore.setConnected(hello as Capabilities);
    connectionStore.setProgress({ state: "Session started", details: "", progress: 100 });
    this.callbacks.onProgress?.("Session started", "", 100);
    this.callbacks.onConnect?.();
    this.serverPreciseWheel = Boolean(hello["wheel.precise"]);
    this.startPingLoop();
    this.processAudioCaps(hello);
    this.initClipboard();
    this.initMouse(Boolean(hello["readonly"]), Boolean(hello["shadow"]), Boolean(hello["desktop"]));

    parse_modifiers(hello["modifier_keycodes"] as Parameters<typeof parse_modifiers>[0]);
    parse_server_modifiers(hello["modifiers-keynames"] as Parameters<typeof parse_server_modifiers>[0]);

    this.initKeyboard(Boolean(hello["readonly"]));
    this.sendKeymap();
    this.sendConfigureDisplay();
    this.startResizeListener();
  }

  private async onChallenge(packet: unknown): Promise<void> {
    const [, serverSalt, cipherOutCaps, digest, saltDigest] = packet as [
      string, Uint8Array, unknown, string, string, string,
    ];
    const passwords = this.options.passwords;
    if (!passwords || passwords.length === 0) {
      this.disconnect("server requires password, none provided");
      return;
    }
    if (!this.isDigestSafe(digest)) {
      this.disconnect("refusing insecure digest without encryption");
      return;
    }
    if (cipherOutCaps && this.transport && this.options.encryptionKey) {
      this.transport.setCipherOut(
        cipherOutCaps as Parameters<ProtocolTransport["setCipherOut"]>[0],
        this.options.encryptionKey,
      );
    }

    const password = passwords.shift()!;
    const serverSaltStr = Uint8ToString(serverSalt);
    const clientSalt = saltDigest === "xor"
      ? xor(serverSaltStr, password)
      : getSecureRandomString(32);
    const hexSalt = saltDigest === "xor"
      ? serverSaltStr + clientSalt
      : await gendigest(saltDigest, clientSalt, serverSaltStr);

    const challengeResponse = await gendigest(digest, password, hexSalt);
    const caps = this.buildCaps();
    (caps as Record<string, unknown>)["challenge_response"] = challengeResponse;
    (caps as Record<string, unknown>)["challenge_client_salt"] = clientSalt;
    this.send([PACKET_TYPES.hello, caps]);
  }

  // -----------------------------------------------------------------------
  // Hello / capabilities — delegates to Phase 7b builder
  // -----------------------------------------------------------------------

  private sendHello(): void {
    connectionStore.setProgress({ state: "Sending handshake", details: "", progress: 80 });
    this.callbacks.onProgress?.("Sending handshake", "", 80);

    const caps = this.buildCaps();
    if (this.options.passwords?.length) {
      (caps as Record<string, unknown>)["challenge"] = true;
    }
    const c = caps as Record<string, unknown>;
    console.log("[xpra-hello] SENDING clipboard caps:", JSON.stringify(c["clipboard"]));
    this.send([PACKET_TYPES.hello, caps]);
  }

  private buildCaps(): Capabilities {
    const s = settingsStore.settings;
    const input: CapabilitiesBuilderInput = {
      container: this.container ?? document.createElement("div"),
      keyboardLayout: s.keyboardLayout,
      supportedEncodings: s.supportedEncodings,
      encodingOptions: settingsStore.getEncodingOptions() as EncodingOptions,
      audioCodecs: this.audioManager?.getCodecNames() ?? [],
      clipboardEnabled: s.clipboardEnabled,
      clipboardPoll: s.clipboardPoll,
      clipboardPreferredFormat: s.clipboardPreferredFormat,
      printing: s.printing,
      openUrl: s.openUrl,
      username: this.options.username ?? s.username,
      uuid: this.uuid,
      sharing: this.options.sharing ?? s.sharing,
      steal: this.options.steal ?? s.steal,
      vrefresh: s.vrefresh,
      bandwidthLimit: s.bandwidthLimit,
      startNewSession: this.options.startNewSession ?? null,
      encryption: this.options.encryptionKey ? "AES-CBC" : false,
      encryptionKey: this.options.encryptionKey,
    };
    return makeHello(input);
  }

  // -----------------------------------------------------------------------
  // Display configuration
  // -----------------------------------------------------------------------

  private sendConfigureDisplay(): void {
    const w = this.container?.clientWidth || window.innerWidth || 1024;
    const h = this.container?.clientHeight || window.innerHeight || 768;
    const dpi = getDPI();
    const vrefresh = settingsStore.settings.vrefresh;
    console.log(
      "[xpra-display] sendConfigureDisplay: container=%dx%d, window.inner=%dx%d, resolved=%dx%d, dpi=%d",
      this.container?.clientWidth, this.container?.clientHeight,
      window.innerWidth, window.innerHeight,
      w, h, dpi,
    );
    const packet = [PACKET_TYPES.configure_display, {
      "desktop-size": [w, h],
      "monitors": Object.fromEntries(getMonitors(w, h, dpi, vrefresh)),
      "dpi": { x: dpi, y: dpi },
      "vrefresh": vrefresh,
      "screen-sizes": getScreenSizes(w, h, dpi),
    }];
    this.send(packet as ClientPacket);
    connectionStore.setSessionInfo(connectionStore.sessionName, w, h);
  }

  private startResizeListener(): void {
    this.stopResizeListener();
    this.resizeHandler = () => {
      console.log(
        "[xpra-display] resize event: container=%dx%d, window.inner=%dx%d",
        this.container?.clientWidth, this.container?.clientHeight,
        window.innerWidth, window.innerHeight,
      );
      window.clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = window.setTimeout(() => {
        if (connectionStore.isConnected()) {
          console.log(
            "[xpra-display] resize debounced → sendConfigureDisplay",
          );
          this.sendConfigureDisplay();
        }
      }, 250);
    };
    window.addEventListener("resize", this.resizeHandler);
  }

  private stopResizeListener(): void {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    window.clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = 0;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildUri(opts: ConnectOptions): string {
    const proto = opts.webTransport ? "https" : opts.ssl ? "wss" : "ws";
    const port = opts.port || (opts.ssl ? 443 : 80);
    const path = opts.path?.startsWith("/") ? opts.path : `/${opts.path ?? ""}`;
    return `${proto}://${opts.host}:${port}${path}`;
  }

  private clearTimers(): void {
    window.clearTimeout(this.helloTimer);
    window.clearInterval(this.pingTimer);
    this.helloTimer = 0;
    this.pingTimer = 0;
  }

  private startPingLoop(): void {
    this.pingTimer = window.setInterval(() => {
      if (this.transport) {
        this.send([PACKET_TYPES.ping, Date.now()]);
      }
    }, PING_FREQUENCY);
  }

  private isDigestSafe(digest: string): boolean {
    return (
      digest !== "xor" ||
      Boolean(this.options.ssl) ||
      Boolean(this.options.encryptionKey) ||
      isSafeHost(this.options.host)
    );
  }

  // -----------------------------------------------------------------------
  // Audio
  // -----------------------------------------------------------------------

  private initAudio(): void {
    this.audioManager = new AudioManager({
      onSend: (p) => this.send(p),
      isConnected: () => connectionStore.isConnected(),
      onStateChange: (state, details) => {
        setAudioPlaybackState(state);
        logDebug("audio state:", state, details);
      },
      debug: (cat, ...args) => logDebug(`audio:${cat}`, ...args),
      log: (...args) => log("[xpra-audio]", ...args),
      warn: (...args) => warn("[xpra-audio]", ...args),
      error: (...args) => logError("[xpra-audio]", ...args),
    });
    this.audioManager.init();

    enableAudio(this.audioManager.isEnabled());
    setAudioCodecList(
      Object.fromEntries(
        this.audioManager.getCodecNames().map((c) => [c, c]),
      ),
    );
    setActiveAudioFramework(this.audioManager.getFramework());
    setActiveAudioCodec(this.audioManager.getCodec());
    setAudioBackendFlags({
      mediasource: typeof MediaSource !== "undefined",
      aurora: Boolean((globalThis as unknown as Record<string, unknown>).AV),
    });
  }

  private processAudioCaps(hello: Record<string, unknown>): void {
    if (!this.audioManager) return;
    const audioCaps = hello["audio"] as Record<string, unknown> | undefined;
    if (audioCaps) {
      this.audioManager.processServerCaps(audioCaps);
      enableAudio(this.audioManager.isEnabled());
      setActiveAudioFramework(this.audioManager.getFramework());
      setActiveAudioCodec(this.audioManager.getCodec());
    }
  }

  // -----------------------------------------------------------------------
  // Input
  // -----------------------------------------------------------------------

  private initMouse(serverReadonly: boolean, isShadow: boolean, isDesktop: boolean): void {
    const s = settingsStore.settings;
    const self = this;

    const ctx = {
      get scale() { return settingsStore.settings.scale; },
      get server_readonly() { return serverReadonly; },
      get connected() { return connectionStore.isConnected(); },
      server_is_shadow: isShadow,
      server_is_desktop: isDesktop,
      server_precise_wheel: this.serverPreciseWheel,
      swap_keys: s.swapKeys,
      scroll_reverse_x: s.scrollReverseX as boolean,
      scroll_reverse_y: s.scrollReverseY === "auto" ? ("auto" as const) : s.scrollReverseY === "true",
      middle_emulation_modifier: s.middleEmulationModifier,
      middle_emulation_button: s.middleEmulationButton,
      get focused_wid() { return focusedWid(); },
      send: (packet: unknown[]) => self.send(packet as ClientPacket),
      set_focus: (win: MouseWindow) => {
        import("@/store/client-bridge").then(({ focusWindow: fw }) => fw(win.wid));
      },
      debug: () => {},
    };

    const handler = new MouseHandler(ctx);
    this.mouseHandler = handler;

    registerMouseForwarder((type, e, win) => {
      switch (type) {
        case "down":
          handler.on_mousedown(e as unknown as MouseEventLike, win);
          break;
        case "up":
          handler.on_mouseup(e as unknown as MouseEventLike, win);
          break;
        case "move":
          handler.on_mousemove(e as unknown as MouseEventLike, win);
          break;
        case "wheel":
          handler.on_mousescroll(e as WheelEvent, win);
          break;
      }
    });
    console.log("[xpra-mouse] MouseHandler initialized");
  }

  private charToDomKeyCode(ch: string): number {
    if (ch >= "a" && ch <= "z") return ch.toUpperCase().charCodeAt(0);
    if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0);
    if (ch >= "0" && ch <= "9") return ch.charCodeAt(0);
    if (ch === "\n" || ch === "\r") return 13;
    if (ch === "\t") return 9;
    if (ch === " ") return 32;
    if (ch === ";") return 186;
    if (ch === "=") return 187;
    if (ch === ",") return 188;
    if (ch === "-") return 189;
    if (ch === ".") return 190;
    if (ch === "/") return 191;
    if (ch === "`") return 192;
    if (ch === "[") return 219;
    if (ch === "\\") return 220;
    if (ch === "]") return 221;
    if (ch === "'") return 222;
    return ch.charCodeAt(0);
  }

  private typeTextAsKeystrokes(text: string): void {
    const wid = focusedWid();
    if (!wid || !text) return;
    const modifiers: string[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const keycode = this.charToDomKeyCode(ch);
      const keyname = ch === "\n" ? "Return" : ch === "\t" ? "Tab" : ch;
      const keystring = keyname;
      this.send([PACKET_TYPES.key_action, wid, keyname, true, modifiers, keycode, keystring, keycode, 0] as ClientPacket);
      this.send([PACKET_TYPES.key_action, wid, keyname, false, modifiers, keycode, keystring, keycode, 0] as ClientPacket);
    }
  }

  private initClipboard(): void {
    if (this.clipboardManager) {
      this.clipboardManager.destroy();
    }
    const s = settingsStore.settings;
    this.clipboardManager = new ClipboardManager({
      enabled: s.clipboardEnabled,
      poll: s.clipboardPoll,
      preferredFormat: s.clipboardPreferredFormat || UTF8_STRING,
      targets: [UTF8_STRING, "text/plain", "text/html", "image/png"],
      pasteboard: "#pasteboard",
      screenElement: "#screen",
      onSend: (packet) => this.send(packet),
      isConnected: () => connectionStore.isConnected(),
      onTypeText: (text) => this.typeTextAsKeystrokes(text),
      debug: (cat, ...args) => console.log(`[xpra-clip:${cat}]`, ...args),
      log: (...args) => console.log("[xpra-clip]", ...args),
    });
    this.clipboardManager.init();
  }

  private clipboardDelayedEventTime = 0;

  private initKeyboard(serverReadonly: boolean): void {
    if (this.keyboardController) {
      this.keyboardController.destroy();
    }
    const cm = this.clipboardManager;
    const clipEnabled = settingsStore.settings.clipboardEnabled;
    console.log("[xpra-kbd] clipboardEnabled=", clipEnabled);
    this.keyboardController = new KeyboardController({
      send: (packet) => {
        console.log("[xpra-kbd] sending key-action:", JSON.stringify(packet.slice(1)));
        this.send(packet as ClientPacket);
      },
      getFocusedWid: () => {
        const wid = focusedWid();
        return wid;
      },
      getServerReadonly: () => serverReadonly,
      swapKeys: settingsStore.settings.swapKeys,
      keyboardLayout: settingsStore.settings.keyboardLayout,
      clipboardEnabled: clipEnabled,
      getClipboardDirection: () => "both",
      getClipboardDelayedEventTime: () => this.clipboardDelayedEventTime,
      setClipboardDelayedEventTime: (t: number) => { this.clipboardDelayedEventTime = t; },
      onPreparePasteForServer: () => cm?.preparePasteForServer(),
      onPreparePasteForTerminal: () => {
        if (!cm || !cm.enabled) return;
        const nav = navigator.clipboard;
        if (!nav?.readText) return;
        nav.readText().then(
          (text) => {
            if (!text) return;
            this.typeTextAsKeystrokes(text);
          },
          (err) => console.warn("[xpra-clip] onPreparePasteForTerminal: clipboard read failed:", err),
        );
      },
      onPasteAsKeystrokes: () => {
        const nav = navigator.clipboard;
        if (!nav?.readText) return;
        nav.readText().then(
          (text) => {
            if (!text) return;
            console.log("[kbd-paste] typing", text.length, "chars as keystrokes");
            this.typeTextAsKeystrokes(text);
          },
          (err) => console.warn("[kbd-paste] clipboard read failed:", err),
        );
      },
      onSuppressNextPaste: () => cm?.suppressNextPaste(),
      sendShiftInsert: () => {
        const wid = focusedWid();
        if (!wid) return;
        const modifiers = ["shift"];
              this.send([PACKET_TYPES.key_action, wid, "Insert", true, modifiers, 65379, "Insert", 0, 0] as ClientPacket);
              this.send([PACKET_TYPES.key_action, wid, "Insert", false, modifiers, 65379, "Insert", 0, 0] as ClientPacket);
      },
      getFocusedAppHint: () => getFocusedAppHint(),
      isFocusedDesktop: () => {
        const wid = focusedWid();
        return wid ? (windows()[wid]?.isDesktop ?? false) : false;
      },
      debug: (cat, ...args) => console.log(`[xpra-kbd:${cat}]`, ...args),
      log: (...args) => console.log("[xpra-kbd]", ...args),
      warn: (...args) => console.warn("[xpra-kbd]", ...args),
    });
    this.keyboardController.init();
    this.keyboardController.enable();
    console.log("[xpra-kbd] KeyboardController initialized, state:", this.keyboardController.getState());
  }

  private sendKeymap(): void {
    if (!this.keyboardController) return;
    const layout = this.keyboardController.getKeyboardLayout();
    const keycodes = this.keyboardController.getKeycodes();
    const keymap = { layout, keycodes };
    console.log("[xpra-kbd] sending keymap-changed, layout=", layout, "keycodes count=", keycodes.length);
    this.send([PACKET_TYPES.keymap_changed, { keymap }, false] as unknown as ClientPacket);
  }

  private initDecodeWorker(): void {
    try {
      this.decodeWorker = new Worker(
        new URL("../workers/decode-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.decodeWorker.addEventListener("message", (e: MessageEvent<DecodeWorkerOutbound>) => {
        this.onDecodeWorkerMessage(e.data);
      });
      this.decodeWorker.addEventListener("error", (e) => {
        logError("decode worker error:", e.message);
      });
    } catch (err) {
      warn("failed to create decode worker, falling back to main-thread decoding:", err);
      this.decodeWorker = null;
    }
  }

  private onDecodeWorkerMessage(msg: DecodeWorkerOutbound): void {
    switch (msg.c) {
      case "ready":
        logDebug("decode worker ready");
        break;
      case "draw":
        this.onDecodedDraw(msg.packet as DrawPacket, msg.start);
        break;
      case "error":
        logError("decode worker error for packet:", msg.error);
        this.sendDamageSequenceAck(msg.packet as DrawPacket, msg.start);
        break;
      case "check-result":
        if (msg.result) {
          logDebug("decode worker formats:", (msg as { formats: string[] }).formats);
        }
        break;
    }
  }

  private onDecodedDraw(packet: DrawPacket, start: number): void {
    const wid = packet[1];
    const renderer = this.getOrCreateRenderer(wid);
    if (!renderer) {
      this.sendDamageSequenceAck(packet, start);
      return;
    }
    renderer.paint(packet, (error?: string) => {
      if (error) {
        logError("paint error wid=", wid, ":", error);
      }
      this.sendDamageSequenceAck(packet, start);
    });
  }

  private processDraw(packet: DrawPacket, start: number): void {
    const wid = packet[1];
    const renderer = this.getOrCreateRenderer(wid);
    if (!renderer) {
      this.sendDamageSequenceAck(packet, start);
      return;
    }
    renderer.paint(packet, (error?: string) => {
      if (error) {
        logError("paint error wid=", wid, ":", error);
      }
      this.sendDamageSequenceAck(packet, start);
    });
  }

  private sendDamageSequenceAck(packet: DrawPacket, start: number): void {
    const packetSequence = packet[8];
    const wid = packet[1];
    const width = packet[4] ?? 0;
    const height = packet[5] ?? 0;
    const elapsed = Math.round(performance.now() - start);
    this.send([
      PACKET_TYPES.damage_sequence,
      packetSequence,
      wid,
      width,
      height,
      elapsed,
      "",
    ]);
  }

  // -----------------------------------------------------------------------
  // Renderer management
  // -----------------------------------------------------------------------

  private ensureRenderer(
    wid: number,
    w: number,
    h: number,
    metadata: Record<string, unknown>,
  ): void {
    setTimeout(() => {
      const canvas = getWindowCanvas(wid);
      if (!canvas) return;
      if (this.renderers.has(wid)) return;
      const renderer = new WindowRenderer({
        canvas,
        width: w,
        height: h,
        hasAlpha: Boolean(metadata["has-alpha"]),
        tray: false,
        useDecodeWorker: Boolean(this.decodeWorker),
        debug: logDebug,
        error: logError,
        exc: logError,
      });
      this.renderers.set(wid, renderer);
    }, 0);
  }

  private getOrCreateRenderer(wid: number): WindowRenderer | null {
    let renderer = this.renderers.get(wid);
    if (renderer) return renderer;

    const canvas = getWindowCanvas(wid);
    if (!canvas) return null;

    const win = windowsStore.getWindow(wid);
    const w = win?.width ?? canvas.width;
    const h = win?.height ?? canvas.height;
    renderer = new WindowRenderer({
      canvas,
      width: w,
      height: h,
      hasAlpha: Boolean(win?.metadata?.["has-alpha"]),
      tray: Boolean(win?.tray),
      useDecodeWorker: Boolean(this.decodeWorker),
      debug: logDebug,
      error: logError,
      exc: logError,
    });
    this.renderers.set(wid, renderer);
    return renderer;
  }

  private resizeRendererCanvas(wid: number, w: number, h: number): void {
    const renderer = this.renderers.get(wid);
    if (renderer) {
      renderer.updateCanvasGeometry(w, h);
    }
  }

  private sendBufferRefresh(wid: number): void {
    this.send([
      PACKET_TYPES.buffer_refresh, wid, 0, 100,
      { "refresh-now": true, batch: { reset: true } },
      {},
    ] as ClientPacket);
  }

  // -----------------------------------------------------------------------
  // Render loop — periodically flush offscreen→visible canvas
  // -----------------------------------------------------------------------

  private startRenderLoop(): void {
    const tick = () => {
      for (const renderer of this.renderers.values()) {
        renderer.draw();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRenderLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}
