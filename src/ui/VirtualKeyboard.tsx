/*
 * Author: Ali Parnan
 *
 * Virtual keyboard — On-screen keyboard using simple-keyboard.
 * Sends key_action packets directly to the xpra server.
 */

import type { Component } from "solid-js";
import { createEffect, createSignal, Show } from "solid-js";
import { virtualKeyboardVisible, hideVirtualKeyboard, sendPacket, focusedWid } from "@/store";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import type { ClientPacket } from "@/core/protocol/types";
import { CHAR_TO_NAME } from "@/core/keycodes/keysym";
import SimpleKeyboard from "simple-keyboard";
import "simple-keyboard/build/css/index.css";
import "./VirtualKeyboard.css";

const SPECIAL_KEY_MAP: Record<string, { keyname: string; keyval: number; keycode: number }> = {
  "{enter}":     { keyname: "Return",      keyval: 65293, keycode: 13 },
  "{bksp}":      { keyname: "BackSpace",   keyval: 65288, keycode: 8 },
  "{tab}":       { keyname: "Tab",         keyval: 65289, keycode: 9 },
  "{space}":     { keyname: "space",       keyval: 32,    keycode: 32 },
  "{escape}":    { keyname: "Escape",      keyval: 65307, keycode: 27 },
  "{shift}":     { keyname: "Shift_L",     keyval: 65505, keycode: 16 },
  "{lock}":      { keyname: "Caps_Lock",   keyval: 65509, keycode: 20 },
  "{ctrl}":      { keyname: "Control_L",   keyval: 65507, keycode: 17 },
  "{alt}":       { keyname: "Alt_L",       keyval: 65513, keycode: 18 },
  "{meta}":      { keyname: "Meta_L",      keyval: 65511, keycode: 91 },
  "{arrowup}":   { keyname: "Up",          keyval: 65362, keycode: 38 },
  "{arrowdown}": { keyname: "Down",        keyval: 65364, keycode: 40 },
  "{arrowleft}": { keyname: "Left",        keyval: 65361, keycode: 37 },
  "{arrowright}":{ keyname: "Right",       keyval: 65363, keycode: 39 },
  "{delete}":    { keyname: "Delete",      keyval: 65535, keycode: 46 },
  "{home}":      { keyname: "Home",        keyval: 65360, keycode: 36 },
  "{end}":       { keyname: "End",         keyval: 65367, keycode: 35 },
  "{pageup}":    { keyname: "Page_Up",     keyval: 65365, keycode: 33 },
  "{pagedown}":  { keyname: "Page_Down",   keyval: 65366, keycode: 34 },
  "{f1}":        { keyname: "F1",          keyval: 65470, keycode: 112 },
  "{f2}":        { keyname: "F2",          keyval: 65471, keycode: 113 },
  "{f3}":        { keyname: "F3",          keyval: 65472, keycode: 114 },
  "{f4}":        { keyname: "F4",          keyval: 65473, keycode: 115 },
  "{f5}":        { keyname: "F5",          keyval: 65474, keycode: 116 },
  "{f6}":        { keyname: "F6",          keyval: 65475, keycode: 117 },
  "{f7}":        { keyname: "F7",          keyval: 65476, keycode: 118 },
  "{f8}":        { keyname: "F8",          keyval: 65477, keycode: 119 },
  "{f9}":        { keyname: "F9",          keyval: 65478, keycode: 120 },
  "{f10}":       { keyname: "F10",         keyval: 65479, keycode: 121 },
  "{f11}":       { keyname: "F11",         keyval: 65480, keycode: 122 },
  "{f12}":       { keyname: "F12",         keyval: 65481, keycode: 123 },
};

const MODIFIER_KEYS = new Set(["{shift}", "{lock}", "{ctrl}", "{alt}", "{meta}"]);

function sendKeyPress(button: string, modifiers: string[]): void {
  const wid = focusedWid();
  if (!wid) return;

  const special = SPECIAL_KEY_MAP[button];
  if (special) {
    sendPacket([PACKET_TYPES.key_action, wid, special.keyname, true, modifiers, special.keyval, special.keyname, special.keycode, 0] as unknown as ClientPacket);
    if (!MODIFIER_KEYS.has(button)) {
      sendPacket([PACKET_TYPES.key_action, wid, special.keyname, false, modifiers, special.keyval, special.keyname, special.keycode, 0] as unknown as ClientPacket);
    }
    return;
  }

  const ch = button;
  // Resolve proper X11 keysym name: "@" → "at", "€" → "EuroSign", etc.
  // Raw characters like "@" are not valid X11 keysym names and confuse the server.
  const keyname = CHAR_TO_NAME[ch] ?? ch;
  const cp = ch.codePointAt(0) ?? ch.charCodeAt(0);
  // X11 keysym value: BMP chars ≤ U+00FF use code point directly,
  // higher Unicode chars use the 0x01000000 | codepoint convention.
  const keyval = cp <= 0x00ff ? cp : (0x01000000 | cp);
  sendPacket([PACKET_TYPES.key_action, wid, keyname, true, modifiers, keyval, ch, cp, 0] as unknown as ClientPacket);
  sendPacket([PACKET_TYPES.key_action, wid, keyname, false, modifiers, keyval, ch, cp, 0] as unknown as ClientPacket);
}

export const VirtualKeyboard: Component = () => {
  let containerEl: HTMLDivElement | undefined;
  let keyboard: SimpleKeyboard | null = null;
  const [shiftActive, setShiftActive] = createSignal(false);
  const [ctrlActive, setCtrlActive] = createSignal(false);
  const [altActive, setAltActive] = createSignal(false);

  const handleKeyPress = (button: string) => {
    if (button === "{shift}") {
      setShiftActive((v) => !v);
      return;
    }
    if (button === "{ctrl}") {
      setCtrlActive((v) => !v);
      return;
    }
    if (button === "{alt}") {
      setAltActive((v) => !v);
      return;
    }

    // Alt selects the character from the alt layer but is not sent as a modifier.
    // Sending mod1 (Alt) alongside "@" would be interpreted as Alt+@ by the app.
    const mods: string[] = [];
    if (shiftActive()) mods.push("shift");
    if (ctrlActive()) mods.push("control");
    sendKeyPress(button, mods);

    if (shiftActive()) setShiftActive(false);
    if (ctrlActive()) setCtrlActive(false);
    if (altActive()) setAltActive(false);
  };

  createEffect(() => {
    const visible = virtualKeyboardVisible();
    if (!visible || !containerEl) return;

    keyboard = new SimpleKeyboard(containerEl, {
      onChange: () => {},
      onKeyPress: handleKeyPress,
      theme: "hg-theme-default hg-theme-ios",
      physicalKeyboardHighlight: true,
      stopMouseDownPropagation: true,
      preventMouseDownDefault: true,
      layout: {
        default: [
          "` 1 2 3 4 5 6 7 8 9 0 - = {bksp}",
          "{tab} q w e r t y u i o p [ ] \\",
          "{lock} a s d f g h j k l ; ' {enter}",
          "{shift} z x c v b n m , . / {shift}",
          "{ctrl} {alt} {space} {alt} {ctrl}",
        ],
        shift: [
          "~ ! @ # $ % ^ & * ( ) _ + {bksp}",
          "{tab} Q W E R T Y U I O P { } |",
          '{lock} A S D F G H J K L : " {enter}',
          "{shift} Z X C V B N M < > ? {shift}",
          "{ctrl} {alt} {space} {alt} {ctrl}",
        ],
        alt: [
          "° ² ³ ¼ ½ ¾ { [ ] } \\ ~ ` {bksp}",
          "{tab} @ € ® ™ ü ú í ó ö ¿ « |",
          "{lock} á ß ð ƒ © ˙ ĵ ķ ł ø ´ {enter}",
          "{shift} æ × ¢ ∨ ∧ ñ µ ≤ ≥ ÷ {shift}",
          "{ctrl} {alt} {space} {alt} {ctrl}",
        ],
      },
      display: {
        "{bksp}": "⌫",
        "{enter}": "↵",
        "{tab}": "⇥",
        "{lock}": "⇪",
        "{shift}": "⇧",
        "{ctrl}": "Ctrl",
        "{alt}": "Alt",
        "{space}": " ",
        "{escape}": "Esc",
      },
    });

    return () => {
      if (keyboard) {
        keyboard.destroy();
        keyboard = null;
      }
    };
  });

  createEffect(() => {
    // Read all signals FIRST so SolidJS tracks them even on the initial run
    // when keyboard may still be null. Without this, the early return would
    // prevent dependency registration and the effect would never re-run.
    const name = altActive() ? "alt" : shiftActive() ? "shift" : "default";
    const activeButtons: string[] = [];
    if (shiftActive()) activeButtons.push("{shift}");
    if (ctrlActive()) activeButtons.push("{ctrl}");
    if (altActive()) activeButtons.push("{alt}");

    if (!keyboard) return;
    keyboard.setOptions({
      layoutName: name,
      buttonTheme: activeButtons.length
        ? [{ class: "hg-activeButton", buttons: activeButtons.join(" ") }]
        : [],
    });
  });

  return (
    <Show when={virtualKeyboardVisible()} fallback={null}>
      <div class="virtual-keyboard-wrapper">
        <button
          class="vkbd-close-btn"
          onClick={() => hideVirtualKeyboard()}
          title="Close keyboard"
          aria-label="Close virtual keyboard"
        >
          ×
        </button>
        <div ref={(el) => { containerEl = el; }} class="simple-keyboard" />
      </div>
    </Show>
  );
};
