/*
 * Author: Ali Parnan
 *
 * Window-related packet handlers: new_window, lost_window, configure, etc.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { isDesktopWindow } from "@/store/windows";
import type {
  MapWindowPacket,
  ConfigureWindowPacket,
  FocusPacket,
  ConfigureOverrideRedirectPacket,
  DesktopSizePacket,
  InitiateMoveResizePacket,
  LostWindowPacket,
  NewOverrideRedirectPacket,
  NewTrayPacket,
  NewWindowPacket,
  PointerPositionPacket,
  RaiseWindowPacket,
  ServerPacket,
  WindowIconPacket,
  WindowMetadataPacket,
  WindowMoveResizePacket,
  WindowResizedPacket,
} from "@/core/protocol/types";
import type { HandlerContext } from "./types";
import {
  addWindow,
  removeWindow,
  setFocusedWindow,
  focusedWid,
  windows,
  updateWindow,
  updateWindowMetadata,
  setMaximized,
  setFullscreen,
  getWindow,
  ensureVisible,
} from "@/store/windows";

// ---------------------------------------------------------------------------
// new_window
// ---------------------------------------------------------------------------

export function handleNewWindow(packet: NewWindowPacket, ctx: HandlerContext): void {
  const [, wid, x, y, w, h, metadata, clientProperties] = packet;
  if (w <= 0 || h <= 0) {
    ctx.log?.("window dimensions invalid:", w, h);
    return;
  }
  let clientProps: Record<string, unknown> = {};
  if (clientProperties) clientProps = clientProperties as Record<string, unknown>;

  const isDeskWin = isDesktopWindow(metadata);
  const desktopWidth = ctx.desktopWidth ?? window.innerWidth;
  const desktopHeight = ctx.desktopHeight ?? window.innerHeight;
  const windowCount = ctx.windowsStore?.getWindowCount?.() ?? 0;
  const TASKBAR_H = 36;

  let winW = w;
  let winH = h;
  let posX = x;
  let posY = y;

  if (isDeskWin) {
    posX = 0;
    posY = 0;
  } else {
    if (!metadata["fullscreen"] && !metadata["maximized"]) {
      winW = Math.min(w, desktopWidth);
      winH = Math.min(h, desktopHeight - TASKBAR_H);
    }

    if (x === 0 && y === 0 && !metadata["set-initial-position"] && !metadata["fullscreen"]) {
      if (windowCount === 0) {
        posX = Math.round((desktopWidth - winW) / 2);
        posY = Math.round((desktopHeight - TASKBAR_H - winH) / 2);
        posX = Math.max(0, posX);
        posY = Math.max(0, posY);
      } else {
        posX = Math.min(windowCount * 10, Math.max(0, desktopWidth - 100));
        posY = 96;
      }
    }

    const clamped = ensureVisible(posX, posY, winW, winH);
    posX = clamped.x;
    posY = clamped.y;
  }

  addWindow(wid, posX, posY, winW, winH, metadata, false, false, clientProps);

  ctx.send([PACKET_TYPES.map_window, wid, posX, posY, winW, winH, clientProps] as MapWindowPacket);
  ctx.send([PACKET_TYPES.configure_window, wid, posX, posY, winW, winH, clientProps, 0, {}, false] as ConfigureWindowPacket);

  setFocusedWindow(wid);
  ctx.send([PACKET_TYPES.focus, wid, []] as FocusPacket);

  ctx.onNewWindow?.(wid, posX, posY, winW, winH, metadata, clientProps);
}

// ---------------------------------------------------------------------------
// new_override_redirect
// ---------------------------------------------------------------------------

export function handleNewOverrideRedirect(
  packet: NewOverrideRedirectPacket,
  ctx: HandlerContext,
): void {
  const [, wid, x, y, w, h, metadata, clientProperties] = packet;
  if (w <= 0 || h <= 0) {
    ctx.log?.("window dimensions invalid:", w, h);
    return;
  }
  let clientProps: Record<string, unknown> = {};
  if (clientProperties) clientProps = clientProperties as Record<string, unknown>;

  const desktopWidth = ctx.desktopWidth ?? 0;
  const desktopHeight = ctx.desktopHeight ?? 0;
  const windowCount = ctx.windowsStore?.getWindowCount?.() ?? 0;

  let posX = x;
  let posY = y;
  if (x === 0 && y === 0 && !metadata["set-initial-position"] && !metadata["fullscreen"]) {
    if (windowCount === 0) {
      if (w <= desktopWidth) posX = Math.round((desktopWidth - w) / 2);
      if (h <= desktopHeight) posY = Math.round((desktopHeight - h) / 2);
    } else {
      posX = Math.min(windowCount * 10, Math.max(0, desktopWidth - 100));
      posY = 96;
    }
  }

  addWindow(wid, posX, posY, w, h, metadata, true, false, clientProps);

  ctx.send([PACKET_TYPES.map_window, wid, posX, posY, w, h, clientProps] as MapWindowPacket);
  ctx.send([PACKET_TYPES.configure_window, wid, posX, posY, w, h, clientProps, 0, {}, false] as ConfigureWindowPacket);

  ctx.onNewOverrideRedirect?.(wid, posX, posY, w, h, metadata, clientProps);
}

// ---------------------------------------------------------------------------
// new_tray
// ---------------------------------------------------------------------------

export function handleNewTray(packet: NewTrayPacket, ctx: HandlerContext): void {
  const wid = packet[1];
  const metadata = packet[4];
  addWindow(wid, 0, 0, 24, 24, metadata, false, true);
  ctx.onNewTray?.(wid, metadata);
}

// ---------------------------------------------------------------------------
// lost_window
// ---------------------------------------------------------------------------

export function handleLostWindow(packet: LostWindowPacket, ctx: HandlerContext): void {
  const wid = packet[1];
  const wasFocused = focusedWid() === wid;
  ctx.onBeforeLostWindow?.(wid);
  removeWindow(wid);
  ctx.onLostWindow?.(wid);

  if (wasFocused) {
    const remaining = windows();
    let topWid = 0;
    let topLayer = -1;
    for (const id in remaining) {
      const w = remaining[id];
      if (w && !w.overrideRedirect && !w.tray) {
        const layer = w.stackingLayer ?? 0;
        if (layer > topLayer) {
          topLayer = layer;
          topWid = w.wid;
        }
      }
    }
    setFocusedWindow(topWid);
    ctx.send([PACKET_TYPES.focus, topWid, []] as FocusPacket);
  }

  ctx.onLastWindow?.();
}

// ---------------------------------------------------------------------------
// window_metadata
// ---------------------------------------------------------------------------

export function handleWindowMetadata(packet: WindowMetadataPacket, ctx: HandlerContext): void {
  const wid = packet[1];
  const metadata = packet[2];
  const win = getWindow(wid);

  console.log("[window-metadata] wid=", wid, "keys=", Object.keys(metadata).join(","),
    "maximized" in metadata ? `maximized=${metadata.maximized}` : "",
    "fullscreen" in metadata ? `fullscreen=${metadata.fullscreen}` : "",
  );

  updateWindowMetadata(wid, metadata);

  if ("maximized" in metadata) {
    const want = Boolean(metadata.maximized);
    if (want !== (win?.maximized ?? false)) {
      console.log("[window-metadata] wid=", wid, "MAXIMIZE change:", win?.maximized, "→", want);
      setMaximized(wid, want);
      const updated = getWindow(wid);
      if (updated) {
        ctx.onWindowMoveResize?.(wid, updated.x, updated.y, updated.width, updated.height);
      }
    }
  }
  if ("fullscreen" in metadata) {
    const want = Boolean(metadata.fullscreen);
    if (want !== (win?.fullscreen ?? false)) {
      console.log("[window-metadata] wid=", wid, "FULLSCREEN change:", win?.fullscreen, "→", want);
      setFullscreen(wid, want);
      const updated = getWindow(wid);
      if (updated) {
        ctx.onWindowMoveResize?.(wid, updated.x, updated.y, updated.width, updated.height);
      }
    }
  }

  ctx.onWindowMetadata?.(wid, metadata);
}

// ---------------------------------------------------------------------------
// window_resized
// ---------------------------------------------------------------------------

export function handleWindowResized(packet: WindowResizedPacket, ctx: HandlerContext): void {
  const [, wid, width, height] = packet;
  const win = getWindow(wid);
  const { x, y } = ensureVisible(win?.x ?? 0, win?.y ?? 0, width, height);
  console.log("[window-resized] wid=", wid, "size=", width, "x", height, "pos=", x, y, "(was", win?.x, win?.y, win?.width, "x", win?.height, ")");
  updateWindow(wid, { x, y, width, height });
  ctx.onWindowResized?.(wid, width, height);
}

// ---------------------------------------------------------------------------
// window_move_resize
// ---------------------------------------------------------------------------

export function handleWindowMoveResize(packet: WindowMoveResizePacket, ctx: HandlerContext): void {
  const [, wid, rawX, rawY, width, height] = packet;
  const { x, y } = ensureVisible(rawX, rawY, width, height);
  console.log("[window-move-resize] wid=", wid, "raw=", rawX, rawY, width, "x", height, "→ adjusted=", x, y);
  updateWindow(wid, { x, y, width, height });
  ctx.onWindowMoveResize?.(wid, x, y, width, height);
}

// ---------------------------------------------------------------------------
// configure_override_redirect
// ---------------------------------------------------------------------------

export function handleConfigureOverrideRedirect(
  packet: ConfigureOverrideRedirectPacket,
  ctx: HandlerContext,
): void {
  const [, wid, x, y, width, height] = packet;
  updateWindow(wid, { x, y, width, height });
  ctx.onConfigureOverrideRedirect?.(wid, x, y, width, height);
}

// ---------------------------------------------------------------------------
// window_icon
// ---------------------------------------------------------------------------

export function handleWindowIcon(packet: WindowIconPacket, ctx: HandlerContext): void {
  const [, wid, w, h, encoding, imgData] = packet;
  ctx.debug?.("window", "window-icon:", encoding, "size", w, "x", h);
  ctx.onWindowIcon?.(wid, w, h, encoding, imgData);
}

// ---------------------------------------------------------------------------
// raise_window
// ---------------------------------------------------------------------------

export function handleRaiseWindow(packet: RaiseWindowPacket, ctx: HandlerContext): void {
  const wid = packet[1];
  setFocusedWindow(wid);
  ctx.onRaiseWindow?.(wid);
}

// ---------------------------------------------------------------------------
// initiate_moveresize
// ---------------------------------------------------------------------------

export function handleInitiateMoveResize(
  packet: InitiateMoveResizePacket,
  ctx: HandlerContext,
): void {
  const [, wid, xRoot, yRoot, direction, button, sourceIndication] = packet;
  ctx.onInitiateMoveResize?.(wid, xRoot, yRoot, direction, button, sourceIndication);
}

// ---------------------------------------------------------------------------
// pointer_position
// ---------------------------------------------------------------------------

export function handlePointerPosition(
  packet: PointerPositionPacket,
  ctx: HandlerContext,
): void {
  const wid = packet[1];
  let x = packet[2];
  let y = packet[3];
  const deltaX = packet[4];
  const deltaY = packet[5];

  if (deltaX !== undefined && deltaY !== undefined) {
    const pos = ctx.getWindowGeometry?.(wid);
    if (pos) {
      x = pos.x + deltaX;
      y = pos.y + deltaY;
    }
  }

  ctx.onPointerPosition?.(wid, x, y);
}

// ---------------------------------------------------------------------------
// desktop_size
// ---------------------------------------------------------------------------

export function handleDesktopSize(packet: DesktopSizePacket, ctx: HandlerContext): void {
  ctx.onDesktopSize?.(packet);
}

// ---------------------------------------------------------------------------
// Export map
// ---------------------------------------------------------------------------

export const windowHandlers: Partial<
  Record<string, (packet: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.new_window]: handleNewWindow as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.new_override_redirect]:
    handleNewOverrideRedirect as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.new_tray]: handleNewTray as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.lost_window]: handleLostWindow as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.window_metadata]:
    handleWindowMetadata as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.window_resized]:
    handleWindowResized as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.window_move_resize]:
    handleWindowMoveResize as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.configure_override_redirect]:
    handleConfigureOverrideRedirect as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.window_icon]: handleWindowIcon as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.raise_window]: handleRaiseWindow as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.initiate_moveresize]:
    handleInitiateMoveResize as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.pointer_position]:
    handlePointerPosition as (p: ServerPacket, c: HandlerContext) => void,
  [PACKET_TYPES.desktop_size]: handleDesktopSize as (p: ServerPacket, c: HandlerContext) => void,
};
