/*
 * Author: Ali Parnan
 */

/**
 * Connection store — State Machine with Solid Signals.
 * Manages connection state, reconnect logic, and session info.
 * Ported from Client.js connection state (init_state, _process_hello, disconnect, do_reconnect).
 */

import { createSignal } from "solid-js";
import type { Capabilities } from "@/core/protocol/types";

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectionProgress {
  state: string;
  details: string;
  progress: number;
}

export interface ServerInfo {
  display: string;
  platform: string;
  resizeExact: boolean;
  screenSizes: unknown[];
  isDesktop: boolean;
  isShadow: boolean;
  readonly: boolean;
  remoteLogging: boolean;
  startTime: number;
  connectionData: boolean;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const [connectionState, setConnectionState] = createSignal<ConnectionState>("disconnected");
const [disconnectReason, setDisconnectReason] = createSignal<string | null>(null);
const [reconnectInProgress, setReconnectInProgress] = createSignal(false);
const [reconnectAttempt, setReconnectAttempt] = createSignal(0);
const [sessionName, setSessionName] = createSignal<string | undefined>(undefined);
const [desktopWidth, setDesktopWidth] = createSignal(0);
const [desktopHeight, setDesktopHeight] = createSignal(0);
const [capabilities, setCapabilities] = createSignal<Capabilities>({});
const [_progress, setProgressValue] = createSignal<ConnectionProgress>({
  state: "",
  details: "",
  progress: 0,
});

/** Reactive accessor for connection progress (use in Solid components). */
export const progress = _progress;

const [serverInfo, setServerInfo] = createSignal<ServerInfo>({
  display: "",
  platform: "",
  resizeExact: false,
  screenSizes: [],
  isDesktop: false,
  isShadow: false,
  readonly: false,
  remoteLogging: false,
  startTime: -1,
  connectionData: false,
});

// ---------------------------------------------------------------------------
// Derived / computed
// ---------------------------------------------------------------------------

export function isConnected(): boolean {
  return connectionState() === "connected";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function setConnecting(): void {
  setConnectionState("connecting");
  setDisconnectReason(null);
}

export function setConnected(caps: Capabilities): void {
  setConnectionState("connected");
  setCapabilities(caps);
  setDisconnectReason(null);
  setReconnectAttempt(0);
}

export function setReconnecting(): void {
  setConnectionState("reconnecting");
  setReconnectInProgress(true);
}

export function setReconnectAttemptCount(n: number): void {
  setReconnectAttempt(n);
}

export function clearReconnecting(): void {
  setReconnectInProgress(false);
}

export function setError(reason: string): void {
  setConnectionState("error");
  setDisconnectReason(reason);
}

export function setDisconnected(reason: string | null): void {
  setConnectionState("disconnected");
  setDisconnectReason(reason);
  setReconnectInProgress(false);
}

export function setConnectionProgress(p: ConnectionProgress): void {
  setProgressValue(p);
}

/** Alias for setConnectionProgress (used by client). */
export const setProgress = setConnectionProgress;

/** Update desktop dimensions only (used by client). */
export function setDesktopSize(width: number, height: number): void {
  setDesktopWidth(width);
  setDesktopHeight(height);
}

export function setSessionInfo(
  name: string | undefined,
  width: number,
  height: number,
): void {
  setSessionName(name);
  setDesktopWidth(width);
  setDesktopHeight(height);
}

export function updateServerInfo(updates: Partial<ServerInfo>): void {
  setServerInfo((prev) => ({ ...prev, ...updates }));
}

export function resetConnectionStore(): void {
  setConnectionState("disconnected");
  setDisconnectReason(null);
  setReconnectInProgress(false);
  setReconnectAttempt(0);
  setSessionName(undefined);
  setDesktopWidth(0);
  setDesktopHeight(0);
  setCapabilities({});
  setProgressValue({ state: "", details: "", progress: 0 });
  setServerInfo({
    display: "",
    platform: "",
    resizeExact: false,
    screenSizes: [],
    isDesktop: false,
    isShadow: false,
    readonly: false,
    remoteLogging: false,
    startTime: -1,
    connectionData: false,
  });
}

// ---------------------------------------------------------------------------
// Store object (for destructuring or passing around)
// ---------------------------------------------------------------------------

export const connectionStore = {
  get state() {
    return connectionState();
  },
  get disconnectReason() {
    return disconnectReason();
  },
  get reconnectInProgress() {
    return reconnectInProgress();
  },
  get reconnectAttempt() {
    return reconnectAttempt();
  },
  get sessionName() {
    return sessionName();
  },
  get desktopWidth() {
    return desktopWidth();
  },
  get desktopHeight() {
    return desktopHeight();
  },
  get capabilities() {
    return capabilities();
  },
  get progress() {
    return _progress();
  },
  get serverInfo() {
    return serverInfo();
  },
  isConnected,
  setConnecting,
  setConnected,
  setReconnecting,
  setReconnectAttemptCount,
  clearReconnecting,
  setError,
  setDisconnected,
  setConnectionProgress,
  setProgress,
  setDesktopSize,
  setSessionInfo,
  updateServerInfo,
  reset: resetConnectionStore,
};
