/*
 * Author: Ali Parnan
 */

import { PACKET_TYPES } from "../constants/packet-types";
import { clientToServer, getMouseButton } from "./coordinates";
import {
  get_event_modifiers,
  translate_modifiers,
} from "../keycodes/modifiers";
import { normalizeWheel } from "../utils/platform";

/** Internal window geometry (x, y, w, h). */
export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Window-like object with wid and get_internal_geometry. */
export interface MouseWindow {
  wid: number;
  canvas?: HTMLCanvasElement;
  get_internal_geometry(): WindowGeometry;
}

/** Mouse event (MouseEvent, PointerEvent, WheelEvent). */
export interface MouseEventLike
  extends Pick<
    MouseEvent,
    | "clientX"
    | "clientY"
    | "movementX"
    | "movementY"
    | "which"
    | "button"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "metaKey"
    | "target"
    | "preventDefault"
  > {
  wheelDelta?: number;
  wheelDeltaX?: number;
  wheelDeltaY?: number;
  detail?: number;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  getModifierState?: (key: string) => boolean;
}

/** Result of getMouse(). */
export interface MousePosition {
  x: number;
  y: number;
  button: number;
}

/** Context/callbacks required by MouseHandler. */
export interface MouseHandlerContext {
  scale: number;
  server_readonly: boolean;
  connected: boolean;
  server_is_shadow: boolean;
  server_is_desktop: boolean;
  server_precise_wheel: boolean;
  swap_keys: boolean;
  scroll_reverse_x: boolean | "auto";
  scroll_reverse_y: boolean | "auto";
  middle_emulation_modifier: string;
  middle_emulation_button: number;
  focused_wid: number;
  send(packet: unknown[]): void;
  set_focus(win: MouseWindow): void;
  is_float_menu_target?(target: EventTarget | null): boolean;
  debug?(category: string, ...args: unknown[]): void;
}

const FLOAT_MENU_SELECTOR = "#float_menu";

/**
 * Mouse handler for Xpra client.
 * Extracted from Client.js (~11 methods).
 * Manages mouse position, clicks, scroll, and pointer lock.
 */
export class MouseHandler {
  private ctx: MouseHandlerContext;
  private last_mouse_x: number | null = null;
  private last_mouse_y: number | null = null;
  private mousedown_event: MouseEventLike | null = null;
  private mouseup_event: MouseEventLike | null = null;
  private wheel_delta_x = 0;
  private wheel_delta_y = 0;
  private mouse_grabbed = false;
  private last_button_event: [number, boolean, number, number] = [0, false, 0, 0];
  private buttons_pressed = new Set<number>();

  constructor(ctx: MouseHandlerContext) {
    this.ctx = ctx;
  }

  /** Whether the pointer is locked (grabbed). */
  get grabbed(): boolean {
    return this.mouse_grabbed;
  }

  set grabbed(value: boolean) {
    this.mouse_grabbed = value;
  }

  /** Last mousedown event (for initiate_moveresize). */
  get mousedown(): MouseEventLike | null {
    return this.mousedown_event;
  }

  /** Last mouseup event (for initiate_moveresize). */
  get mouseup(): MouseEventLike | null {
    return this.mouseup_event;
  }

  /** Currently pressed buttons. */
  get pressedButtons(): ReadonlySet<number> {
    return this.buttons_pressed;
  }

  /**
   * Get mouse position from event, with scale, scroll, and pointer lock handling.
   */
  getMouse(e: MouseEventLike, _win?: MouseWindow | null): MousePosition {
    const pointerLocked = Boolean(
      typeof document !== "undefined" && document.pointerLockElement,
    );
    const scrollLeft =
      typeof document !== "undefined"
        ? document.documentElement.scrollLeft + document.body.scrollLeft
        : 0;
    const scrollTop =
      typeof document !== "undefined"
        ? document.documentElement.scrollTop + document.body.scrollTop
        : 0;

    const result = clientToServer(e, {
      scale: this.ctx.scale,
      scrollLeft,
      scrollTop,
      pointerLocked,
      lastX: this.last_mouse_x,
      lastY: this.last_mouse_y,
    });

    this.last_mouse_x = result.newLastX;
    this.last_mouse_y = result.newLastY;

    const button = getMouseButton(e);
    return {
      x: result.x,
      y: result.y,
      button,
    };
  }

  private getModifiers(e: MouseEventLike): string[] {
    const raw = get_event_modifiers(e);
    return translate_modifiers(raw, this.ctx.swap_keys);
  }

  private buildCoords(mouse: MousePosition, win: MouseWindow | null, e?: MouseEventLike): number[] {
    if (win) {
      const canvas = win.canvas;
      const pos = win.get_internal_geometry();
      if (canvas && e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / (rect.width || 1);
        const scaleY = canvas.height / (rect.height || 1);
        const relX = ((e as MouseEvent).clientX - rect.left) * scaleX;
        const relY = ((e as MouseEvent).clientY - rect.top) * scaleY;
        const absX = pos.x + relX;
        const absY = pos.y + relY;
        return [Math.round(absX), Math.round(absY), Math.round(relX), Math.round(relY)];
      }
      return [
        Math.round(mouse.x), Math.round(mouse.y),
        Math.round(mouse.x - pos.x), Math.round(mouse.y - pos.y),
      ];
    }
    return [Math.round(mouse.x), Math.round(mouse.y)];
  }

  on_mousedown(e: MouseEventLike, win: MouseWindow | null): boolean {
    this.mousedown_event = e;
    this.mouseup_event = null;
    console.log("[MouseHandler] mousedown wid=", win?.wid, "button=", getMouseButton(e), "connected=", this.ctx.connected, "readonly=", this.ctx.server_readonly);
    this.do_window_mouse_click(e, win, true);
    return !win;
  }

  on_mouseup(e: MouseEventLike, win: MouseWindow | null): boolean {
    this.mouseup_event = e;
    console.log("[MouseHandler] mouseup wid=", win?.wid, "button=", getMouseButton(e));
    this.do_window_mouse_click(e, win, false);
    return !win;
  }

  on_mousemove(e: MouseEventLike, win: MouseWindow | null): boolean {
    if (this.mouse_grabbed) {
      return true;
    }
    if (
      this.ctx.server_readonly ||
      !this.ctx.connected ||
      (!win && this.ctx.server_is_shadow)
    ) {
      return !win;
    }
    const mouse = this.getMouse(e);
    const modifiers = this.getModifiers(e);
    const buttons: number[] = [];
    const coords = this.buildCoords(mouse, win, e);
    let wid = 0;
    if (this.ctx.server_is_desktop) wid = 1;
    if (win) {
      wid = win.wid;
      e.preventDefault?.();
    }
    this.ctx.send([
      PACKET_TYPES.pointer_position,
      wid,
      coords,
      modifiers,
      buttons,
    ]);
    return !win;
  }

  /**
   * Release all currently pressed buttons (e.g. on window blur).
   */
  release_buttons(e: MouseEventLike, win: MouseWindow | null): void {
    const mouse = this.getMouse(e);
    const modifiers = this.getModifiers(e);
    const coords = this.buildCoords(mouse, win, e);
    let wid = 0;
    if (win) wid = win.wid;
    for (const button of this.buttons_pressed) {
      this.send_button_action(wid, button, false, coords, modifiers);
    }
  }

  do_window_mouse_click(
    e: MouseEventLike,
    win: MouseWindow | null,
    pressed: boolean,
  ): void {
    if (win) {
      e.preventDefault?.();
    }
    if (
      this.ctx.server_readonly ||
      this.mouse_grabbed ||
      !this.ctx.connected ||
      (!win && this.ctx.server_is_shadow)
    ) {
      return;
    }
    const isFloatMenu =
      this.ctx.is_float_menu_target?.(e.target) ??
      (() => {
        const t = e.target as HTMLElement | null;
        if (!t) return false;
        if (t.id === FLOAT_MENU_SELECTOR.slice(1)) return true;
        return t.closest?.(FLOAT_MENU_SELECTOR) != null;
      })();
    if (isFloatMenu) {
      this.ctx.debug?.("mouse", "clicked on float_menu, skipping", e);
      return;
    }

    const mouse = this.getMouse(e, win);
    const x = Math.round(mouse.x);
    const y = Math.round(mouse.y);
    const modifiers = this.getModifiers(e);
    const coords = this.buildCoords(mouse, win, e);
    let wid = 0;
    if (this.ctx.server_is_desktop) wid = 1;
    if (win) {
      wid = win.wid;
      if (wid > 0 && this.ctx.focused_wid !== wid) {
        this.ctx.set_focus(win);
      }
    }

    let button = mouse.button;
    const emulate_mod = (this.ctx.middle_emulation_modifier || "").toLowerCase();
    const emulate_with: Record<string, boolean> = {
      control: !!e.ctrlKey,
      meta: !!e.metaKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
    };
    const modifier_active =
      emulate_mod && emulate_with[emulate_mod];
    if (modifier_active && button === 1) {
      button = this.ctx.middle_emulation_button || 2;
      const jsMod =
        emulate_mod.charAt(0).toUpperCase() + emulate_mod.slice(1);
      const translated_mod =
        translate_modifiers([jsMod], this.ctx.swap_keys)[0] ?? "";
      const mod_index = modifiers.indexOf(translated_mod);
      if (mod_index >= 0) {
        modifiers.splice(mod_index, 1);
      }
    }

    if (
      this.last_button_event[0] === button &&
      this.last_button_event[1] === pressed &&
      this.last_button_event[2] === x &&
      this.last_button_event[3] === y
    ) {
      this.ctx.debug?.("mouse", "skipping duplicate click event");
      return;
    }
    this.last_button_event = [button, pressed, x, y];
    this.ctx.debug?.("mouse", "click:", button, pressed, x, y);

    // X11 wheel buttons: 4/5 -> 8/9
    if (button === 4) button = 8;
    else if (button === 5) button = 9;

    this.send_button_action(wid, button, pressed, coords, modifiers);
  }

  send_button_action(
    wid: number,
    button: number,
    pressed: boolean,
    coords: number[],
    modifiers: string[],
  ): void {
    const buttons: number[] = [];
    if (pressed) {
      this.buttons_pressed.add(button);
    } else {
      this.buttons_pressed.delete(button);
    }
    console.log("[MouseHandler] SEND button-action wid=", wid, "button=", button, "pressed=", pressed, "coords=", coords, "mods=", modifiers);
    this.ctx.send([
      PACKET_TYPES.button_action,
      wid,
      button,
      pressed,
      coords,
      modifiers,
      buttons,
    ]);
  }

  /**
   * Detect vertical scroll direction from wheel event.
   * Source: https://deepmikoto.com/coding/1--javascript-detect-mouse-wheel-direction
   * @returns -1 (scroll up), 1 (scroll down), or 0
   */
  detect_vertical_scroll_direction(e: MouseEventLike): number {
    if (!e) return 0;
    let delta = 0;
    if ("wheelDelta" in e && e.wheelDelta) {
      delta = e.wheelDelta;
    } else if ("detail" in e && e.detail) {
      delta = -e.detail;
    }
    if (!delta) return 0;
    if (delta > 0) return -1;
    if (delta < 0) return 1;
    return 0;
  }

  on_mousescroll(e: WheelEvent, win: MouseWindow | null): boolean {
    if (
      this.ctx.server_readonly ||
      this.mouse_grabbed ||
      !this.ctx.connected ||
      (!win && this.ctx.server_is_shadow)
    ) {
      return false;
    }
    const mouse = this.getMouse(e as unknown as MouseEventLike);
    const modifiers = this.getModifiers(e as unknown as MouseEventLike);
    const buttons: number[] = [];
    const coords = this.buildCoords(mouse, win, e as unknown as MouseEventLike);
    let wid = 0;
    if (win) wid = win.wid;

    const wheel = normalizeWheel(e);
    this.ctx.debug?.("mouse", "normalized wheel event:", wheel);

    let px = Math.min(1200, wheel.pixelX);
    let py = Math.min(1200, wheel.pixelY);
    if (this.ctx.scroll_reverse_x) {
      px = -px;
    }
    if (
      this.ctx.scroll_reverse_y === true ||
      (this.ctx.scroll_reverse_y === "auto" &&
        this.detect_vertical_scroll_direction(e as unknown as MouseEventLike) <
          0 &&
        py > 0)
    ) {
      py = -py;
    }
    const apx = Math.abs(px);
    const apy = Math.abs(py);

    if (this.ctx.server_precise_wheel) {
      if (apx > 0) {
        const button_x = px >= 0 ? 7 : 6;
        const xdist = Math.round((px * 1000) / 120);
        this.ctx.send([
          PACKET_TYPES.wheel_motion,
          wid,
          button_x,
          -xdist,
          coords,
          modifiers,
          buttons,
        ]);
      }
      if (apy > 0) {
        const button_y = py >= 0 ? 5 : 4;
        const ydist = Math.round((py * 1000) / 120);
        this.ctx.send([
          PACKET_TYPES.wheel_motion,
          wid,
          button_y,
          -ydist,
          coords,
          modifiers,
          buttons,
        ]);
      }
      return false;
    }

    if (apx >= 40 && apx <= 160) {
      this.wheel_delta_x = px > 0 ? 120 : -120;
    } else {
      this.wheel_delta_x += px;
    }
    if (apy >= 40 && apy <= 160) {
      this.wheel_delta_y = py > 0 ? 120 : -120;
    } else {
      this.wheel_delta_y += py;
    }

    let wx = Math.abs(this.wheel_delta_x);
    let wy = Math.abs(this.wheel_delta_y);
    const button_x = this.wheel_delta_x >= 0 ? 7 : 6;
    const button_y = this.wheel_delta_y >= 0 ? 5 : 4;
    while (wx >= 120) {
      wx -= 120;
      this.ctx.send([
        PACKET_TYPES.button_action,
        wid,
        button_x,
        true,
        coords,
        modifiers,
        buttons,
      ]);
      this.ctx.send([
        PACKET_TYPES.button_action,
        wid,
        button_x,
        false,
        coords,
        modifiers,
        buttons,
      ]);
    }
    while (wy >= 120) {
      wy -= 120;
      this.ctx.send([
        PACKET_TYPES.button_action,
        wid,
        button_y,
        true,
        coords,
        modifiers,
        buttons,
      ]);
      this.ctx.send([
        PACKET_TYPES.button_action,
        wid,
        button_y,
        false,
        coords,
        modifiers,
        buttons,
      ]);
    }
    this.wheel_delta_x = this.wheel_delta_x >= 0 ? wx : -wx;
    this.wheel_delta_y = this.wheel_delta_y >= 0 ? wy : -wy;
    e.preventDefault();
    return false;
  }
}
