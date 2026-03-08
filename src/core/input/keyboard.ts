/*
 * Author: Ali Parnan
 */

/**
 * Keyboard input handler with state machine and AbortController cleanup.
 * Ported from Client.js keyboard logic (Phase 5a).
 *
 * State machine: disabled -> waiting -> active -> locked
 * - disabled: No capture, keys pass through to browser
 * - waiting: Keyboard layout map loading (navigator.keyboard.getLayoutMap)
 * - active: Normal capture, keys sent to server
 * - locked: Pointer lock active, keys still captured
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import {
  KEY_TO_NAME,
  DEAD_KEYS,
  NUMPAD_TO_NAME,
  KEYSYM_TO_LAYOUT,
  CHARCODE_TO_NAME,
  CHARCODE_TO_NAME_SHIFTED,
} from "@/core/keycodes/key-maps";
import { CHAR_TO_NAME } from "@/core/keycodes/keysym";
import {
  get_event_modifiers,
  translate_modifiers,
  patch_altgr,
  type ModifierEvent,
} from "@/core/keycodes/modifiers";
import { getKeyboardLayout, getFirstBrowserLanguage, isMacOS, isWindows } from "@/core/utils/platform";

const CLIPBOARD_EVENT_DELAY = 100;
const DOM_KEY_LOCATION_RIGHT = 2;
const NUM_LOCK_KEYCODE = 144;

export type KeyboardState = "disabled" | "waiting" | "active" | "locked";

export interface KeyboardControllerOptions {
  send: (packet: unknown[]) => void;
  getFocusedWid: () => number;
  getServerReadonly: () => boolean;
  swapKeys: boolean;
  keyboardLayout: string | null;
  clipboardEnabled: boolean;
  getClipboardDirection: () => string;
  getClipboardDelayedEventTime: () => number;
  setClipboardDelayedEventTime: (t: number) => void;
  /** Called on Ctrl+V/Cmd+V keydown – proactive clipboard read for standard apps */
  onPreparePasteForServer?: () => void;
  /** Read clipboard and type text as keystrokes (terminal/desktop paste) */
  onPasteAsKeystrokes?: () => void;
  /** Suppress the next native paste event (when we already handle clipboard) */
  onSuppressNextPaste?: () => void;
  /** Returns the app hint of the currently focused window */
  getFocusedAppHint?: () => string;
  /** Whether the focused window is a desktop/shadow root window */
  isFocusedDesktop?: () => boolean;
  onLayoutChange?: (newLayout: string) => void;
  debug?: (category: string, ...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export interface KeyboardLayoutMap {
  get(key: string): string | undefined;
  keys(): IterableIterator<string>;
}

export class KeyboardController {
  private state: KeyboardState = "disabled";
  private readonly abortController = new AbortController();
  private readonly options: KeyboardControllerOptions;

  private keyboardMap: Record<string, string> = {};
  private lastKeycodePressed = 0;
  private altgrState = false;
  private numLock = false;
  private keyPackets: unknown[][] = [];
  private keyLayout: string;
  private browserLanguage: string | null = null;
  private browserLanguageChangeEmbargoTime = 0;
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
  private enableAfterInit = false;

  constructor(options: KeyboardControllerOptions) {
    this.options = options;
    this.keyLayout = getKeyboardLayout();
    this.browserLanguage = getFirstBrowserLanguage();
  }

  getState(): KeyboardState {
    return this.state;
  }

  getCaptureKeyboard(): boolean {
    return this.state === "active" || this.state === "locked";
  }

  init(): void {
    this.queryKeyboardMap();
  }

  destroy(): void {
    this.abortController.abort();
    for (const id of this.pendingTimeouts) {
      clearTimeout(id);
    }
    this.pendingTimeouts = [];
    this.state = "disabled";
  }

  enable(): void {
    if (this.state === "waiting") {
      this.enableAfterInit = true;
      return;
    }
    this.state = "active";
  }

  disable(): void {
    this.state = "disabled";
  }

  setLocked(locked: boolean): void {
    if (locked && (this.state === "active" || this.state === "locked")) {
      this.state = "locked";
    } else if (!locked && this.state === "locked") {
      this.state = "active";
    }
  }

  doInitKeyboard(): void {
    this.altgrState = false;
    this.attachKeyListeners();
  }

  private attachKeyListeners(): void {
    const signal = this.abortController.signal;

    const onKeyDown = (e: KeyboardEvent) => {
      console.log("[kbd-listener] keydown code=", e.code, "key=", e.key, "aborted=", signal.aborted, "state=", this.state);
      if (signal.aborted) return;
      const r = this.processKeyEvent(true, e);
      console.log("[kbd-listener] keydown result allowDefault=", r);
      if (!r) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (signal.aborted) return;
      const r = this.processKeyEvent(false, e);
      if (!r) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown, { signal, capture: true });
    document.addEventListener("keyup", onKeyUp, { signal, capture: true });
  }

  queryKeyboardMap(): void {
    const keyboard = (navigator as { keyboard?: { getLayoutMap: () => Promise<KeyboardLayoutMap>; addEventListener?: (type: string, cb: () => void) => void } }).keyboard;
    this.keyboardMap = {};
    this.state = "waiting";

    const finalize = () => {
      this.doInitKeyboard();
      if (this.enableAfterInit) {
        this.enableAfterInit = false;
        this.state = "active";
      } else {
        this.state = "active";
      }
    };

    if (!keyboard) {
      this.options.log?.("keyboard: navigator.keyboard not available");
      finalize();
      return;
    }

    keyboard.getLayoutMap().then(
      (keyboardLayoutMap) => {
        if (this.abortController.signal.aborted) return;
        this.options.log?.("keyboard: got layout map");
        for (const key of keyboardLayoutMap.keys()) {
          const value = keyboardLayoutMap.get(key);
          if (value) this.keyboardMap[key] = value;
        }
        finalize();
      },
      (error) => {
        this.options.warn?.("keyboard: failed to get layout map:", error);
        finalize();
      }
    );

    if (keyboard.addEventListener) {
      keyboard.addEventListener("layoutchange", () => {
        this.options.log?.("keyboard layout has changed!");
      });
    }
  }

  sendKeymap(keymap: Record<string, unknown>): void {
    this.options.send([PACKET_TYPES.keymap_changed, { keymap }, false]);
  }

  getModifiers(event: ModifierEvent): string[] {
    const modifiers = get_event_modifiers(event);
    return this.translateModifiers(modifiers);
  }

  translateModifiers(modifiers: string[]): string[] {
    let newModifiers = modifiers;
    if (this.altgrState) {
      newModifiers = patch_altgr(modifiers);
    }
    return translate_modifiers(newModifiers, this.options.swapKeys);
  }

  checkBrowserLanguage(keyLayout: string | null): void {
    const now = performance.now();
    if (now < this.browserLanguageChangeEmbargoTime) return;

    let newLayout: string | undefined;
    if (keyLayout) {
      newLayout = keyLayout;
    } else {
      const lang = getFirstBrowserLanguage();
      if (lang && this.browserLanguage !== lang) {
        this.options.log?.("keyboard: browser language changed from", this.keyLayout, "to", lang);
        this.browserLanguage = lang;
        newLayout = getKeyboardLayout();
      } else {
        newLayout = this.getKeyboardLayout();
      }
    }

    if (newLayout && this.keyLayout !== newLayout) {
      this.keyLayout = newLayout;
      this.options.log?.("keyboard: layout changed to", newLayout);
      this.options.onLayoutChange?.(newLayout);
      this.browserLanguageChangeEmbargoTime = now + 1000;
    } else {
      this.browserLanguageChangeEmbargoTime = now + 100;
    }
  }

  processKeyEvent(pressed: boolean, event: KeyboardEvent): boolean {
    if (this.options.getServerReadonly()) return true;
    if (!this.getCaptureKeyboard()) return true;

    let keyname = event.code || "";
    const keycode = event.which || event.keyCode;
    if (keycode === 229) return true;

    let keystring = event.key || String.fromCharCode(keycode);
    let unpressNow = false;

    this.options.debug?.(
      "keyboard",
      "processKeyEvent",
      pressed ? "DOWN" : "UP",
      "code=", event.code,
      "key=", event.key,
      "keyCode=", keycode,
      "state=", this.state,
    );

    const dead = keystring.toLowerCase() === "dead";
    if (dead && ((this.lastKeycodePressed !== keycode && !pressed) || pressed)) {
      pressed = true;
      unpressNow = true;
    }

    this.lastKeycodePressed = pressed ? keycode : 0;

    if (keycode === NUM_LOCK_KEYCODE && pressed) {
      this.numLock = !this.numLock;
    }

    let keyLanguage: string | null = null;
    const mapString = this.keyboardMap[keyname];

    if (dead && mapString && mapString in DEAD_KEYS) {
      keyname = DEAD_KEYS[mapString];
      keystring = mapString;
    } else if (keyname in KEY_TO_NAME) {
      keyname = KEY_TO_NAME[keyname];
    } else if (keyname === "" && keystring in KEY_TO_NAME) {
      keyname = KEY_TO_NAME[keystring];
    } else if (keyname !== keystring && keystring in NUMPAD_TO_NAME) {
      keyname = NUMPAD_TO_NAME[keystring];
      this.numLock = "0123456789.".includes(keyname);
    } else if (keystring in CHAR_TO_NAME) {
      keyname = CHAR_TO_NAME[keystring];
      if (keyname.includes("_")) {
        const lang = keyname.split("_")[0];
        keyLanguage = KEYSYM_TO_LAYOUT[lang] ?? null;
      }
    } else {
      if (keycode in CHARCODE_TO_NAME) {
        keyname = CHARCODE_TO_NAME[keycode];
      }
      if (event.getModifierState?.("Shift") && keycode in CHARCODE_TO_NAME_SHIFTED) {
        keyname = CHARCODE_TO_NAME_SHIFTED[keycode];
      }
    }

    this.checkBrowserLanguage(keyLanguage);

    if (keyname.match(/_L$/) && (event as { location?: number }).location === DOM_KEY_LOCATION_RIGHT) {
      keyname = keyname.replace("_L", "_R");
    }

    if (
      keystring === "AltGraph" ||
      (keyname === "Alt_R" && (isWindows() || isMacOS())) ||
      (keyname === "Alt_L" && isMacOS())
    ) {
      this.altgrState = pressed;
      keyname = "ISO_Level3_Shift";
      keystring = "AltGraph";
    }

    const rawModifiers = get_event_modifiers(event);
    const modifiers = this.translateModifiers(rawModifiers);
    const keyval = keycode;
    const group = 0;

    const shift = modifiers.includes("shift");
    const capslock = modifiers.includes("lock");
    if ((capslock && shift) || (!capslock && !shift)) {
      keystring = keystring.toLowerCase();
    }

    const ostr = keystring;
    if (this.options.swapKeys) {
      if (keyname === "Control_L") {
        keyname = "Meta_L";
        keystring = "meta";
      } else if (keyname === "Meta_L") {
        keyname = "Control_L";
        keystring = "control";
      } else if (keyname === "Control_R") {
        keyname = "Meta_R";
        keystring = "meta";
      } else if (keyname === "Meta_R") {
        keyname = "Control_R";
        keystring = "control";
      }
    }

    if (pressed && isMacOS() && rawModifiers.includes("Meta") && ostr !== "meta") {
      unpressNow = true;
    }

    let allowDefault = false;
    let terminalPaste = false;
    if (this.options.clipboardEnabled && this.options.getClipboardDirection() !== "to-server") {
      let clipboardModifierKeys = ["Control_L", "Control_R", "Shift_L", "Shift_R"];
      let clipboardModifier = "Control";
      if (isMacOS()) {
        clipboardModifierKeys = ["Meta_L", "Meta_R", "Shift_L", "Shift_R"];
        clipboardModifier = "Meta";
      }
      if (clipboardModifierKeys.includes(keyname)) allowDefault = true;
      if (shift && keyname === "Insert") allowDefault = true;
      const isClipboardModifierSet = rawModifiers.includes(clipboardModifier);
      if (isClipboardModifierSet) {
        const l = keyname.toLowerCase();
        console.log("[kbd-clipboard] modifier active, keyname=", keyname, "l=", l, "rawMods=", rawModifiers, "clipMod=", clipboardModifier);
        if (l === "c" || l === "x") {
          allowDefault = true;
          console.log("[kbd-clipboard] ALLOW DEFAULT for clipboard key:", l);
        }
        if (l === "v") {
          const appHint = this.options.getFocusedAppHint?.() ?? "unknown";
          const isShiftHeld = shift || rawModifiers.includes("Shift");
          const isDesktop = this.options.isFocusedDesktop?.() ?? false;
          console.log("[kbd-clipboard] PASTE key, appHint=", appHint, "shift=", isShiftHeld, "desktop=", isDesktop);
          if (isShiftHeld && (appHint === "terminal" || isDesktop)) {
            terminalPaste = true;
            this.options.onSuppressNextPaste?.();
            this.options.onPasteAsKeystrokes?.();
            console.log("[kbd-clipboard] terminal/desktop paste: Cmd+Shift+V → keystrokes");
          } else if (appHint !== "terminal") {
            allowDefault = true;
            this.options.setClipboardDelayedEventTime(performance.now() + CLIPBOARD_EVENT_DELAY);
            this.options.onSuppressNextPaste?.();
            this.options.onPreparePasteForServer?.();
            console.log("[kbd-clipboard] standard paste for", appHint);
          }
          // terminal + Cmd+V without Shift → do nothing (let it pass through as-is)
        }
      }
    } else {
      if (pressed) console.log("[kbd-clipboard] clipboard check SKIPPED: enabled=", this.options.clipboardEnabled, "direction=", this.options.getClipboardDirection());
    }

    const wid = this.options.getFocusedWid();
    if (terminalPaste && pressed) {
      // Don't send any key packets for the Cmd+Shift+V itself.
      // onPasteAsKeystrokes reads clipboard and types text directly.
      // The subsequent modifier key-up events will flow through normally.
    } else {
      const packet: unknown[] = [PACKET_TYPES.key_action, wid, keyname, pressed, modifiers, keyval, keystring, keycode, group];
      this.keyPackets.push(packet);
      if (unpressNow) {
        this.keyPackets.push([PACKET_TYPES.key_action, wid, keyname, false, modifiers, keyval, keystring, keycode, group]);
      }
    }

    let delay = 0;
    const now = performance.now();
    if (this.options.getClipboardDelayedEventTime() > now) {
      delay = this.options.getClipboardDelayedEventTime() - now;
    }

    const flush = () => {
      if (this.abortController.signal.aborted) return;
      while (this.keyPackets.length > 0) {
        const p = this.keyPackets.shift();
        if (p) this.options.send(p);
      }
    };

    const id = setTimeout(flush, delay);
    this.pendingTimeouts.push(id);
    setTimeout(() => {
      const idx = this.pendingTimeouts.indexOf(id);
      if (idx >= 0) this.pendingTimeouts.splice(idx, 1);
    }, delay + 10);

    if (keyname === "F11") allowDefault = true;
    return allowDefault;
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this.processKeyEvent(true, event);
  }

  onKeyUp(event: KeyboardEvent): boolean {
    return this.processKeyEvent(false, event);
  }

  getKeyboardLayout(): string {
    if (this.options.keyboardLayout) return this.options.keyboardLayout;
    return getKeyboardLayout();
  }

  getKeycodes(): [number, string, number, number, number][] {
    const keycodes: [number, string, number, number, number][] = [];
    for (const kcStr in CHARCODE_TO_NAME) {
      const kc = parseInt(kcStr, 10);
      keycodes.push([kc, CHARCODE_TO_NAME[kc], kc, 0, 0]);
    }
    return keycodes;
  }
}
