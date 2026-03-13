/*
 * Author: Ali Parnan
 */

/**
 * Mutable mapping from JS modifier names to X11 modifier names.
 * Updated at runtime by parse_modifier_key / parse_modifiers / parse_server_modifiers.
 */
export const MODIFIERS_NAMES: Record<string, string> = {
  Control: "control",
  Alt: "mod1",
  Meta: "mod4",
  Shift: "shift",
  AltGraph: "mod5",
  CapsLock: "lock",
  NumLock: "mod2",
  ScrollLock: "",
  Fn: "",
  Hyper: "",
  OS: "",
  Super: "",
  Symbol: "",
  SymbolLock: "",
};

/**
 * Maps X11 modifier keysym names to their Javascript equivalent.
 * We prefer looking up the left ("_L") variants for simplicity,
 * since the right ("_R") ones are more often re-purposed.
 */
export const X11_TO_MODIFIER: Readonly<Record<string, string>> = {
  Num_Lock: "NumLock",
  Alt_L: "Alt",
  Meta_L: "Meta",
  ISO_Level3_Shift: "AltGraph",
  Mode_switch: "AltGraph",
  Control_L: "Control",
  Shift_L: "Shift",
  Caps_Lock: "CapsLock",
  Super_L: "Super",
};

/**
 * Records a modifier mapping in MODIFIERS_NAMES for x11 keysyms listed in X11_TO_MODIFIER.
 */
export function parse_modifier_key(modifier: string, key: string): void {
  const client_modifier = X11_TO_MODIFIER[key];
  if (client_modifier) {
    MODIFIERS_NAMES[client_modifier] = modifier;
  }
}

export interface ModifierEvent {
  getModifierState?: (key: string) => boolean;
  modifiers?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

const ALT_MASK = 1;
const CONTROL_MASK = 2;
const SHIFT_MASK = 4;
const META_MASK = 8;

/**
 * Retrieves a list of modifier names from an event using JS event names
 * (e.g. "Alt", "Shift", "Meta").
 * To get X11 modifier names, pipe through translate_modifiers().
 */
export function get_event_modifiers(event: ModifierEvent): string[] {
  const modifiers: string[] = [];
  if (event.getModifierState) {
    for (const jsmod in MODIFIERS_NAMES) {
      if (event.getModifierState(jsmod)) {
        modifiers.push(jsmod);
      }
    }
  } else if (event.modifiers !== undefined) {
    if (event.modifiers & ALT_MASK) modifiers.push("Alt");
    if (event.modifiers & CONTROL_MASK) modifiers.push("Control");
    if (event.modifiers & SHIFT_MASK) modifiers.push("Shift");
    if (event.modifiers & META_MASK) modifiers.push("Meta");
  } else {
    if (event.altKey) modifiers.push("Alt");
    if (event.ctrlKey) modifiers.push("Control");
    if (event.shiftKey) modifiers.push("Shift");
    if (event.metaKey) modifiers.push("Meta");
  }
  return modifiers;
}

/**
 * Translates JS modifier names to X11 names (e.g. "Alt" -> "mod1").
 * Optionally swaps Meta and Control for macOS clients.
 */
export function translate_modifiers(
  modifiers: string[],
  swap_keys: boolean,
): string[] {
  const new_modifiers: string[] = [];
  const names = { ...MODIFIERS_NAMES };
  if (swap_keys) {
    const meta = names["Meta"];
    const control = names["Control"];
    names["Control"] = meta;
    names["Meta"] = control;
  }

  for (const js_modifier of modifiers) {
    const modifier = names[js_modifier] || "";
    if (modifier) {
      new_modifiers.push(modifier);
    }
  }
  return new_modifiers;
}

/**
 * Adds AltGr to modifier list when appropriate,
 * removing spurious Alt and Control modifiers.
 */
export function patch_altgr(modifiers: string[]): string[] {
  const alt = MODIFIERS_NAMES["Alt"];
  const control = MODIFIERS_NAMES["Control"];
  const altgr = MODIFIERS_NAMES["AltGraph"];

  if (!altgr) return modifiers;

  if (!modifiers.includes(altgr)) {
    modifiers.push(altgr);
  }
  // Always remove spurious Alt and Control when AltGr is active.
  // Previously this only ran when altgr was absent, but Firefox on Linux
  // reports all three (Alt + Control + AltGraph) simultaneously for AltGr keys,
  // which caused the server to receive ["control", "mod1", "mod5"] instead of ["mod5"].
  for (const remove of [alt, control]) {
    if (!remove) continue;
    const index = modifiers.indexOf(remove);
    if (index >= 0) {
      modifiers.splice(index, 1);
    }
  }
  return modifiers;
}

/**
 * Parses modifier keycodes received from the server and updates MODIFIERS_NAMES.
 */
export function parse_modifiers(
  modifier_keycodes: Record<string, Array<Array<string | number>>> | undefined,
): void {
  if (!modifier_keycodes) {
    return;
  }
  for (const modifier in modifier_keycodes) {
    const client_keydefs = modifier_keycodes[modifier];
    for (const client_keydef of client_keydefs) {
      try {
        for (const value of client_keydef) {
          parse_modifier_key(modifier, String(value));
        }
      } catch {
        // ignore invalid entries
      }
    }
  }
}

/**
 * Parses server modifier mappings and updates MODIFIERS_NAMES.
 */
export function parse_server_modifiers(
  modifiers: Record<string, string[]> | undefined,
): void {
  if (!modifiers) {
    return;
  }
  for (const modifier in modifiers) {
    const mappings = modifiers[modifier];
    for (const key of mappings) {
      parse_modifier_key(modifier, key);
    }
  }
}
