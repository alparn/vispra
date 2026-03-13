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
  MODIFIERS_NAMES,
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
  /** Send clipboard-token then Shift+Insert (async, waits for clipboard read) */
  onPreparePasteForTerminal?: () => void;
  /** Send Shift+Insert to trigger paste from X11 CLIPBOARD in xterm */
  sendShiftInsert?: () => void;
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
      if (signal.aborted) return;
      const r = this.processKeyEvent(true, e);
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

    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      this.doInitKeyboard();
      if (this.enableAfterInit) {
        this.enableAfterInit = false;
        this.state = "active";
      } else {
        this.state = "active";
      }
    };

    // Safety: if getLayoutMap() hangs (Permissions-Policy blocks it silently),
    // finalize after 2s so keyboard input is not stuck in "waiting" forever.
    const safetyTimeout = setTimeout(() => {
      if (!finalized) {
        this.options.warn?.("keyboard: getLayoutMap() timed out, proceeding without layout map");
        finalize();
      }
    }, 2000);
    this.pendingTimeouts.push(safetyTimeout);

    if (!keyboard) {
      this.options.log?.("keyboard: navigator.keyboard not available");
      clearTimeout(safetyTimeout);
      finalize();
      return;
    }

    keyboard.getLayoutMap().then(
      (keyboardLayoutMap) => {
        clearTimeout(safetyTimeout);
        if (this.abortController.signal.aborted) return;
        this.options.log?.("keyboard: got layout map");
        for (const key of keyboardLayoutMap.keys()) {
          const value = keyboardLayoutMap.get(key);
          if (value) this.keyboardMap[key] = value;
        }
        finalize();
      },
      (error) => {
        clearTimeout(safetyTimeout);
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
    // translate_modifiers converts JS names ("Alt", "Control") → X11 names ("mod1", "control").
    // patch_altgr compares against X11 names (MODIFIERS_NAMES values), so it MUST run
    // after translation — calling it before with JS names caused it to silently do nothing.
    const translated = translate_modifiers(modifiers, this.options.swapKeys);
    if (this.altgrState) {
      return patch_altgr(translated);
    }
    return translated;
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

    const isMacOptionKey =
      isMacOS() && (keyname === "Alt_L" || keyname === "Alt_R");

    if (
      keystring === "AltGraph" ||
      (keyname === "Alt_R" && (isWindows() || isMacOS())) ||
      (keyname === "Alt_L" && isMacOS())
    ) {
      this.altgrState = pressed;
      keyname = "ISO_Level3_Shift";
      keystring = "AltGraph";
    }

    // On macOS the Option key is used as AltGr to compose characters (@ via
    // Option+L, € via Option+E, etc.). We track altgrState locally but must
    // NOT forward ISO_Level3_Shift to the server: the server's X11 state would
    // then have Level3_Shift active, which corrupts the keysym lookup for the
    // subsequent character key event and silently swallows it.
    // For Linux/Windows the AltGr key fires keystring="AltGraph" directly and
    // is handled correctly — only the Mac-specific Alt_L/Alt_R path is skipped.
    if (isMacOptionKey) {
      return true; // absorbed locally, do not forward to server
    }

    const rawModifiers = get_event_modifiers(event);
    let modifiers = this.translateModifiers(rawModifiers);

    // When AltGr/Option is active and the result is a regular character key
    // (not the AltGr modifier itself), strip the AltGr modifier (mod5) from
    // the packet.  The character is already fully encoded in keyname/keyval;
    // sending mod5 would force the server to look for an AltGr-level mapping
    // in *its own* keyboard layout (often US-only), which often has no
    // matching entry and silently swallows the keystroke.
    const MODIFIER_KEY_NAMES = new Set([
      "Shift_L", "Shift_R", "Control_L", "Control_R",
      "Alt_L", "Alt_R", "Meta_L", "Meta_R",
      "ISO_Level3_Shift", "Mode_switch",
      "Caps_Lock", "Num_Lock", "Scroll_Lock",
      "Super_L", "Super_R", "Hyper_L", "Hyper_R",
    ]);
    if (this.altgrState && !MODIFIER_KEY_NAMES.has(keyname)) {
      const altgrMod = MODIFIERS_NAMES["AltGraph"];
      if (altgrMod) modifiers = modifiers.filter(m => m !== altgrMod);
    }

    // Use the Unicode code point of the actual character as X11 keyval.
    // Browser keyCode (e.g. 81 for the Q key) is wrong for AltGr chars like @, €, {, etc.
    // For BMP chars <= U+00FF the X11 keysym equals the code point directly.
    // For higher Unicode chars (€ = U+20AC, etc.) X11 uses 0x01000000 | codepoint.
    let keyval = keycode;
    if (keystring.length === 1) {
      const cp = keystring.codePointAt(0);
      if (cp !== undefined) {
        keyval = cp <= 0x00ff ? cp : (0x01000000 | cp);
      }
    }
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
        if (l === "c" || l === "x") {
          allowDefault = true;
        }
        if (l === "v") {
          const appHint = this.options.getFocusedAppHint?.() ?? "unknown";
          const isShiftHeld = shift || rawModifiers.includes("Shift");
          const isDesktop = this.options.isFocusedDesktop?.() ?? false;
          if (isShiftHeld && (appHint === "terminal" || isDesktop)) {
            terminalPaste = true;
            this.options.onSuppressNextPaste?.();
            this.options.onPasteAsKeystrokes?.();
          } else if (appHint === "terminal") {
            terminalPaste = true;
            this.options.onSuppressNextPaste?.();
            this.options.onPreparePasteForTerminal?.();
          } else {
            allowDefault = true;
            this.options.setClipboardDelayedEventTime(performance.now() + CLIPBOARD_EVENT_DELAY);
            this.options.onSuppressNextPaste?.();
            this.options.onPreparePasteForServer?.();
          }
        }
      }
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
