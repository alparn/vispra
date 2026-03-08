/*
 * Author: Ali Parnan
 *
 * Handler context interface for packet handlers.
 * The XpraClient orchestrator provides this context.
 */

import type { ClientPacket } from "@/core/protocol/types";
import type { ClipboardManager } from "@/core/features/clipboard";

// ---------------------------------------------------------------------------
// Window-like interface (paint, setCursor, etc.)
// ---------------------------------------------------------------------------

export interface WindowLike {
  wid: number;
  paint(packet: unknown, decodeCallback: (error?: string) => void): void;
  setCursor(encoding: string, w: number, h: number, xhot: number, yhot: number, imgData: Uint8Array): void;
  resetCursor(): void;
  eos(): void;
  updateIcon(w: number, h: number, encoding: string, imgData: Uint8Array): string;
  getInternalGeometry(): { x: number; y: number; w: number; h: number };
  cursorData?: [string, number, number, number, number] | null;
  resize(width: number, height: number): void;
  moveResize(x: number, y: number, width: number, height: number): void;
  destroy(): void;
  tray: boolean;
  decorations: boolean;
  focused: boolean;
  stackingLayer: number;
  metadata: Record<string, unknown>;
  minimized: boolean;
}

// ---------------------------------------------------------------------------
// Handler context — provided by XpraClient orchestrator
// ---------------------------------------------------------------------------

export interface HandlerContext {
  send(packet: ClientPacket): void;
  connectionStore: {
    setConnecting(): void;
    setConnected(info: Record<string, unknown>): void;
    setDisconnected(reason: string | null): void;
    setError(reason: string): void;
    setReconnecting(): void;
    incrementReconnectAttempt(): void;
    setProgress(value: { state: string; details: string; progress: number }): void;
    updateServerInfo(updates: Record<string, unknown>): void;
    setDesktopSize(width: number, height: number): void;
    connected(): boolean;
    reconnectInProgress(): boolean;
    reconnectAttempt(): number;
  };
  windowsStore: {
    addWindow(wid: number, x: number, y: number, w: number, h: number, metadata: Record<string, unknown>, overrideRedirect: boolean, tray: boolean, clientProperties?: Record<string, unknown>): void;
    removeWindow(wid: number): void;
    updateWindowMetadata(wid: number, metadata: Record<string, unknown>): void;
    updateWindow(wid: number, updates: Partial<{ x: number; y: number; width: number; height: number; metadata: Record<string, unknown> }>): void;
    setFocusedWindow(wid: number): void;
    clearAllWindows(): void;
    getWindow?(wid: number): unknown;
    getWindowCount?(): number;
  };
  getWindow?(wid: number): WindowLike | undefined;
  clipboardManager?: ClipboardManager;
  decodeWorker?: Worker;
  desktopWidth: number;
  desktopHeight: number;
  log?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
  debug?(category: string, ...args: unknown[]): void;
  onOpen?(): void;
  onConnectionEstablished?(): void;
  onConnectionLost?(): void;
  onClose?(reason: string): void;
  onHello?(hello: Record<string, unknown>): void;
  onChallenge?(packet: unknown): void;
  processDraw?(packet: unknown, start: number): void;
  processSoundData?(packet: unknown): void;
  processFileReceived?(packet: unknown): void;
  processFileChunk?(packet: unknown): void;
  processAckFileChunk?(packet: unknown): void;
  playBell?(percent: number, pitch: number, duration: number): void;
  closeAudio?(): void;
  redrawWindows?(): void;
  onControlAction?(action: string, packet: unknown): void;
  onNotifyShow?(packet: unknown): void;
  onNotifyClose?(nid: number): void;
  onInfoResponse?(data: Record<string, unknown>): void;
  onSettingChange?(name: string, value: unknown): void;
  onOpenUrl?(url: string): void;
  getShadowPointerElement?(): HTMLElement | null;
  // Connection callbacks
  onConnectionProgress?(state: string, details: string, progress: number): void;
  onError?(reason: string, code?: number): void;
  onDisconnect?(reason: string): void;
  onStartupComplete?(): void;
  reconnectInProgress?(): boolean;
  // Window callbacks
  onNewWindow?(wid: number, x: number, y: number, w: number, h: number, metadata: Record<string, unknown>, clientProps: Record<string, unknown>): void;
  onNewOverrideRedirect?(wid: number, x: number, y: number, w: number, h: number, metadata: Record<string, unknown>, clientProps: Record<string, unknown>): void;
  onNewTray?(wid: number, metadata: Record<string, unknown>): void;
  onBeforeLostWindow?(wid: number): void;
  onLostWindow?(wid: number): void;
  onLastWindow?(): void;
  onWindowMetadata?(wid: number, metadata: Record<string, unknown>): void;
  onWindowResized?(wid: number, width: number, height: number): void;
  onWindowMoveResize?(wid: number, x: number, y: number, width: number, height: number): void;
  onConfigureOverrideRedirect?(wid: number, x: number, y: number, width: number, height: number): void;
  onWindowIcon?(wid: number, w: number, h: number, encoding: string, imgData: Uint8Array): void;
  onRaiseWindow?(wid: number): void;
  onInitiateMoveResize?(wid: number, xRoot: number, yRoot: number, direction: number, button: number, sourceIndication: number): void;
  onPointerPosition?(wid: number, x: number, y: number): void;
  onDesktopSize?(packet: unknown): void;
  getWindowGeometry?(wid: number): { x: number; y: number } | undefined;
  // Input
  resetCursor?(): void;
  setCursorForAllWindows?(encoding: string, w: number, h: number, xhot: number, yhot: number, imgData: Uint8Array): void;
  updateShadowPointer?(wid: number, x: number, y: number, win?: WindowLike): void;
  // Audio
  addSoundData?(codec: string, buf: Uint8Array, metadata: Record<string, unknown>): void;
  audioStartStream?(): void;
  // File transfer
  processSendFile?(packet: unknown): void;
  onFileReceived?(basefilename: string, mimetype: string, printit: boolean, data: Uint8Array, options: Record<string, unknown>): void;
  startFileChunkReceive?(chunkId: string, basefilename: string, mimetype: string, printit: boolean, filesize: number, options: Record<string, unknown>, sendId: string): void;
  onFileChunkReceived?(chunkId: string, chunk: number, fileData: Uint8Array, hasMore: boolean): void;
  processFileChunk?(packet: unknown): void;
  onAckFileChunk?(chunkId: string, state: boolean, errorMessage: string, chunk: number): void;
  processAckFileChunk?(packet: unknown): void;
  // System
  setLastPing?(localTime: number, serverTime: number): void;
  setPingEcho?(lastPingEchoedTime: number, serverLoad: number[], clientPingLatency: number): void;
  setInfoRequestPending?(pending: boolean): void;
  setServerLastInfo?(info: Record<string, unknown>): void;
  dispatchInfoResponse?(info: Record<string, unknown>): void;
  toggleKeyboard?(): void;
  toggleFloatMenu?(): void;
  toggleWindowPreview?(): void;
  closeNotification?(nid: number): void;
  doNotification?(type: string, nid: number, summary: string, body: string, expireTimeout: number, icon: unknown, actions: unknown[], hints: Record<string, unknown>): void;
}
