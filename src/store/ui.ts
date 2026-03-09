/*
 * Author: Ali Parnan
 *
 * UI store — Overlay visibility and UI state.
 * Phase 6b-3: LoginOverlay, ProgressOverlay, SessionInfo, VirtualKeyboard, WindowPreview.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const [_loginVisible, setLoginVisible] = createSignal(false);
const [_loginHeading, setLoginHeading] = createSignal("");
let loginResolveCallback: ((password: string | null) => void) | null = null;
const [_sessionInfoVisible, setSessionInfoVisible] = createSignal(false);
const [_virtualKeyboardVisible, setVirtualKeyboardVisible] = createSignal(false);
const [_windowPreviewVisible, setWindowPreviewVisible] = createSignal(false);
const [_connectOverlayVisible, setConnectOverlayVisible] = createSignal(false);
const [_performancePanelVisible, setPerformancePanelVisible] = createSignal(false);

/** Reactive accessors for overlay visibility (use in Solid components). */
export const loginVisible = _loginVisible;
export const loginHeading = _loginHeading;
export const sessionInfoVisible = _sessionInfoVisible;
export const virtualKeyboardVisible = _virtualKeyboardVisible;
export const windowPreviewVisible = _windowPreviewVisible;
export const connectOverlayVisible = _connectOverlayVisible;
export const performancePanelVisible = _performancePanelVisible;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function showLogin(): void {
  setLoginVisible(true);
}

export function hideLogin(): void {
  setLoginVisible(false);
  loginResolveCallback = null;
}

/** Show login overlay with heading and callback. Used when server sends challenge. */
export function showLoginWithPrompt(
  heading: string,
  callback: (password: string | null) => void,
): void {
  setLoginHeading(heading);
  loginResolveCallback = callback;
  setLoginVisible(true);
}

/** Resolve login: call stored callback and hide. */
export function resolveLogin(password: string | null): void {
  loginResolveCallback?.(password);
  loginResolveCallback = null;
  setLoginVisible(false);
}

export function toggleLogin(): boolean {
  setLoginVisible((v) => !v);
  return loginVisible();
}

export function showSessionInfo(): void {
  setSessionInfoVisible(true);
}

export function hideSessionInfo(): void {
  setSessionInfoVisible(false);
}

export function toggleSessionInfo(): boolean {
  setSessionInfoVisible((v) => !v);
  return sessionInfoVisible();
}

export function showVirtualKeyboard(): void {
  setVirtualKeyboardVisible(true);
}

export function hideVirtualKeyboard(): void {
  setVirtualKeyboardVisible(false);
}

export function toggleVirtualKeyboard(): boolean {
  setVirtualKeyboardVisible((v) => !v);
  return virtualKeyboardVisible();
}

export function showWindowPreview(): void {
  setWindowPreviewVisible(true);
}

export function hideWindowPreview(): void {
  setWindowPreviewVisible(false);
}

export function toggleWindowPreview(): boolean {
  setWindowPreviewVisible((v) => !v);
  return windowPreviewVisible();
}

export function showConnectOverlay(): void {
  setConnectOverlayVisible(true);
}

export function hideConnectOverlay(): void {
  setConnectOverlayVisible(false);
}

export function toggleConnectOverlay(): boolean {
  setConnectOverlayVisible((v) => !v);
  return connectOverlayVisible();
}

export function showPerformancePanel(): void {
  setPerformancePanelVisible(true);
}

export function hidePerformancePanel(): void {
  setPerformancePanelVisible(false);
}

export function togglePerformancePanel(): boolean {
  setPerformancePanelVisible((v) => !v);
  return performancePanelVisible();
}

// ---------------------------------------------------------------------------
// Store object
// ---------------------------------------------------------------------------

export const uiStore = {
  get loginVisible() {
    return loginVisible();
  },
  get loginHeading() {
    return loginHeading();
  },
  get sessionInfoVisible() {
    return sessionInfoVisible();
  },
  get virtualKeyboardVisible() {
    return virtualKeyboardVisible();
  },
  get windowPreviewVisible() {
    return windowPreviewVisible();
  },
  get connectOverlayVisible() {
    return connectOverlayVisible();
  },
  get performancePanelVisible() {
    return performancePanelVisible();
  },
  showLogin,
  hideLogin,
  toggleLogin,
  showSessionInfo,
  hideSessionInfo,
  toggleSessionInfo,
  showVirtualKeyboard,
  hideVirtualKeyboard,
  toggleVirtualKeyboard,
  showWindowPreview,
  hideWindowPreview,
  toggleWindowPreview,
  showConnectOverlay,
  hideConnectOverlay,
  toggleConnectOverlay,
  showPerformancePanel,
  hidePerformancePanel,
  togglePerformancePanel,
};
