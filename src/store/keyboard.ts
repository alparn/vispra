/*
 * Author: Ali Parnan
 */

/**
 * Keyboard store — Keyboard capture and layout state.
 * Holds UI-facing keyboard state; actual key handling is in KeyboardController.
 * Ported from Client.js keyboard-related init_state and init_settings.
 */

import { createSignal } from "solid-js";
import { getKeyboardLayout as getPlatformKeyboardLayout } from "@/core/utils/platform";
import type { KeyboardState } from "@/core/input/keyboard";

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Whether keyboard capture is requested (e.g. user clicked to focus). */
const [captureKeyboardRequested, setCaptureKeyboardRequested] = createSignal(false);

/** Current KeyboardController state: disabled | waiting | active | locked */
const [keyboardState, setKeyboardState] = createSignal<KeyboardState>("disabled");

/** Server-reported keyboard layout (from capabilities). */
const [keyboardLayout, setKeyboardLayout] = createSignal<string | null>(null);

/** Resolved layout (browser or server). */
const [keyLayout, setKeyLayout] = createSignal(getPlatformKeyboardLayout());

// ---------------------------------------------------------------------------
// Getters (reactive)
// ---------------------------------------------------------------------------

export function getCaptureKeyboardRequested(): boolean {
  return captureKeyboardRequested();
}

export function getKeyboardState(): KeyboardState {
  return keyboardState();
}

export function getKeyboardLayout(): string | null {
  return keyboardLayout();
}

export function getKeyLayout(): string {
  return keyLayout();
}

/** Whether keys are actually being captured (active or locked). */
export function isCaptureActive(): boolean {
  const s = keyboardState();
  return s === "active" || s === "locked";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function requestCaptureKeyboard(requested: boolean): void {
  setCaptureKeyboardRequested(requested);
}

export function setKeyboardControllerState(state: KeyboardState): void {
  setKeyboardState(state);
}

export function setServerKeyboardLayout(layout: string | null): void {
  setKeyboardLayout(layout);
  if (layout) setKeyLayout(layout);
}

export function setResolvedKeyLayout(layout: string): void {
  setKeyLayout(layout);
}

// ---------------------------------------------------------------------------
// Store object
// ---------------------------------------------------------------------------

export const keyboardStore = {
  captureKeyboardRequested,
  keyboardState,
  keyboardLayout,
  keyLayout,

  getCaptureKeyboardRequested,
  getKeyboardState,
  getKeyboardLayout,
  getKeyLayout,
  isCaptureActive,

  requestCaptureKeyboard,
  setKeyboardControllerState,
  setServerKeyboardLayout,
  setResolvedKeyLayout,
};
