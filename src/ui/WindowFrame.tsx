/*
 * Author: Ali Parnan
 *
 * Window frame with header bar, canvas, and native drag/resize.
 */

import type { Component } from "solid-js";
import { onMount, onCleanup, createSignal, Show } from "solid-js";
import {
  windows,
  focusWindow,
  raiseWindow,
  updateWindowGeometry,
  sendCloseWindow,
  minimizeWindow,
  registerWindowCanvas,
  unregisterWindowCanvas,
  sendPacket,
  resizeRenderer,
  forwardMouseEvent,
} from "@/store";
import type { WindowState, MouseWindow } from "@/store";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import type { ConfigureWindowPacket, BufferRefreshPacket } from "@/core/protocol/types";
import { setupDragResize, type DragResizeRect } from "@/window/drag-resize";
import { isMacOS } from "@/core/utils/platform";

const HEADER_HEIGHT = 30;
const BORDER_WIDTH = 1;

export interface WindowFrameProps {
  wid: number;
  focused: boolean;
  onClose?: (wid: number) => void;
}

function getScreenViewportSize(): { w: number; h: number } {
  const screenEl = document.getElementById("screen");
  const rect = screenEl?.getBoundingClientRect();
  return {
    w: Math.round(rect?.width ?? screenEl?.clientWidth ?? document.documentElement.clientWidth ?? window.innerWidth),
    h: Math.round(rect?.height ?? screenEl?.clientHeight ?? document.documentElement.clientHeight ?? window.innerHeight),
  };
}

function getOffsets(decorated: boolean) {
  const left = BORDER_WIDTH;
  const right = BORDER_WIDTH;
  const top = BORDER_WIDTH + (decorated ? HEADER_HEIGHT : 0);
  const bottom = BORDER_WIDTH;
  return { left, right, top, bottom };
}

function toOuterRect(
  x: number,
  y: number,
  width: number,
  height: number,
  decorated: boolean,
): DragResizeRect {
  const { left, right, top, bottom } = getOffsets(decorated);
  return {
    x: x - left,
    y: y - top,
    width: width + left + right,
    height: height + top + bottom,
  };
}

function fromOuterRect(
  rect: DragResizeRect,
  decorated: boolean,
): { x: number; y: number; width: number; height: number } {
  const { left, right, top, bottom } = getOffsets(decorated);
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: rect.width - left - right,
    height: rect.height - top - bottom,
  };
}

function sendConfigureWindow(wid: number, x: number, y: number, w: number, h: number): void {
  sendPacket([
    PACKET_TYPES.configure_window, wid, x, y, w, h, {}, 0, {}, false,
  ] as ConfigureWindowPacket);
}

function sendBufferRefresh(wid: number): void {
  sendPacket([
    PACKET_TYPES.buffer_refresh, wid, 0, 100,
    { "refresh-now": true, batch: { reset: true } },
    {},
  ] as BufferRefreshPacket);
}

const TerminalClipboardHint: Component = () => {
  const [open, setOpen] = createSignal(false);
  const mod = isMacOS() ? "Cmd" : "Ctrl";

  return (
    <span
      class="terminal-hint-wrapper"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}
    >
      <span class="terminal-hint-icon" title="Clipboard shortcuts">ⓘ</span>
      <Show when={open()}>
        <div class="terminal-hint-tooltip">
          <strong>Clipboard Shortcuts</strong>
          <div class="terminal-hint-row"><kbd>{mod}+C</kbd> Copy</div>
          <div class="terminal-hint-row"><kbd>{mod}+Shift+V</kbd> Paste</div>
        </div>
      </Show>
    </span>
  );
};

export const WindowFrame: Component<WindowFrameProps> = (props) => {
  const win = (): WindowState | undefined => windows()[props.wid];
  const [desktopLoading, setDesktopLoading] = createSignal(true);
  const [viewportSize, setViewportSize] = createSignal(getScreenViewportSize());
  const [transitionLabel, setTransitionLabel] = createSignal("Synchronizing view…");
  const [transitionActive, setTransitionActive] = createSignal(false);
  const showResizeTransition = () => transitionActive() && !(win()?.isDesktop && desktopLoading());

  const decorated = () => {
    const w = win();
    if (!w) return false;
    if (w.isDesktop) return false;
    return (
      !w.overrideRedirect &&
      !w.tray &&
      ((w.metadata?.decorations as boolean) ?? true) &&
      !(w.fullscreen ?? false)
    );
  };
  const resizable = () => {
    const w = win();
    if (!w) return false;
    if (w.isDesktop) return false;
    if (w.overrideRedirect || w.tray) return false;
    if (w.maximized || w.fullscreen) return false;
    const types = w.windowType ?? [];
    if (types.length === 0) return true;
    return types.some((t) =>
      ["NORMAL", "DIALOG", "UTILITY"].includes(t),
    );
  };

  let containerEl!: HTMLDivElement;
  let headerEl!: HTMLDivElement;
  let canvasEl!: HTMLCanvasElement;
  let transitionHideTimer = 0;

  onMount(() => {
    const wid = props.wid;
    const TAG = `[WindowFrame wid=${wid}]`;

    if (!containerEl) {
      console.error(TAG, "onMount: containerEl is null!");
      return;
    }

    const showTransition = (label: string, minVisibleMs = 900) => {
      setTransitionLabel(label);
      setTransitionActive(true);
      if (transitionHideTimer) clearTimeout(transitionHideTimer);
      transitionHideTimer = window.setTimeout(() => {
        setTransitionActive(false);
        transitionHideTimer = 0;
      }, minVisibleMs);
    };
    const hideTransition = () => {
      if (transitionHideTimer) {
        clearTimeout(transitionHideTimer);
        transitionHideTimer = 0;
      }
      setTransitionActive(false);
    };

    const screenEl = document.getElementById("screen");
    const containment = screenEl;

    const dec = decorated();
    const res = resizable();
    /* Legacy: draggable auf ganzem Fenster, cancel="canvas" – nicht nur Titelleiste */
    const dragHandle = containerEl;

    const w = win();

    console.log(TAG, "setup params", {
      dec,
      res,
      dragHandle: dragHandle?.tagName,
      hasHeader: !!headerEl,
      containment: containment?.id ?? "screen",
    });

    const getRect = (): DragResizeRect => {
      const w = win();
      if (!w) return { x: 0, y: 0, width: 100, height: 100 };
      const r = toOuterRect(w.x, w.y, w.width, w.height, dec);
      return r;
    };

    let resizeThrottleTimer = 0;
    const RESIZE_THROTTLE_MS = 100;

    const commitRect = (outerRect: DragResizeRect): void => {
      const geom = fromOuterRect(outerRect, dec);
      console.log(TAG, "commitRect", { outerRect, geom });
      updateWindowGeometry(wid, geom.x, geom.y, geom.width, geom.height);
      sendConfigureWindow(wid, geom.x, geom.y, geom.width, geom.height);
    };

    const initW = w?.width ?? 0;
    const initH = w?.height ?? 0;
    if (initW && initH) {
      canvasEl.width = initW;
      canvasEl.height = initH;
    }
    registerWindowCanvas(wid, canvasEl);

    if (win()?.isDesktop) {
      const loadTimer = setTimeout(() => setDesktopLoading(false), 3000);
      onCleanup(() => clearTimeout(loadTimer));

      const onResize = () => {
        setViewportSize(getScreenViewportSize());
        showTransition("Adapting workspace…", 1100);
      };
      window.addEventListener("resize", onResize);
      onCleanup(() => window.removeEventListener("resize", onResize));
    } else {
      setDesktopLoading(false);
    }

    const mouseWin: MouseWindow = {
      wid,
      canvas: canvasEl,
      get_internal_geometry() {
        const w = win();
        return { x: w?.x ?? 0, y: w?.y ?? 0, w: w?.width ?? 0, h: w?.height ?? 0 };
      },
    };

    let mouseTracking = false;

    const onCanvasPointerDown = (e: PointerEvent) => {
      mouseTracking = true;
      document.addEventListener("pointermove", onDocumentPointerMove);
      document.addEventListener("pointerup", onDocumentPointerUp);
      forwardMouseEvent("down", e, mouseWin);
    };
    const onDocumentPointerUp = (e: PointerEvent) => {
      mouseTracking = false;
      document.removeEventListener("pointermove", onDocumentPointerMove);
      document.removeEventListener("pointerup", onDocumentPointerUp);
      forwardMouseEvent("up", e, mouseWin);
    };
    const onCanvasPointerMove = (e: PointerEvent) => {
      if (!mouseTracking) forwardMouseEvent("move", e, mouseWin);
    };
    const onDocumentPointerMove = (e: PointerEvent) => {
      forwardMouseEvent("move", e, mouseWin);
    };
    const onCanvasWheel = (e: WheelEvent) => {
      forwardMouseEvent("wheel", e, mouseWin);
      e.preventDefault();
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onGlobalPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t === canvasEl || canvasEl.contains(t)) return;
      if (containerEl.contains(t) && !t.closest(".windowhead") && !t.closest(".windowbtn") && !t.dataset?.resizeHandle) {
        mouseTracking = true;
        document.addEventListener("pointermove", onDocumentPointerMove);
        document.addEventListener("pointerup", onDocumentPointerUp);
        forwardMouseEvent("down", e, mouseWin);
      }
    };

    canvasEl.addEventListener("pointerdown", onCanvasPointerDown);
    canvasEl.addEventListener("pointermove", onCanvasPointerMove);
    canvasEl.addEventListener("wheel", onCanvasWheel, { passive: false });
    canvasEl.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerdown", onGlobalPointerDown, true);

    const teardown = setupDragResize(
      containerEl,
      dragHandle,
      getRect,
      commitRect,
      {
        enabled: true,
        draggable: dec,
        resizable: res,
        containment,
        cancel: "canvas",
        constraints: {
          minWidth: 80,
          minHeight: 50,
        },
        callbacks: {
          onMoveStart: () => {
            raiseWindow(wid);
            focusWindow(wid);
          },
          onMoveEnd: () => {
            sendBufferRefresh(wid);
          },
          onResizeStart: (handle) => {
            console.log(TAG, "onResizeStart", { handle });
            raiseWindow(wid);
            focusWindow(wid);
            showTransition(win()?.isDesktop ? "Reflowing desktop…" : "Resizing window…");
          },
          onResize: (_handle, outerRect) => {
            if (resizeThrottleTimer) return;
            resizeThrottleTimer = window.setTimeout(() => {
              resizeThrottleTimer = 0;
              const g = fromOuterRect(outerRect, dec);
              sendConfigureWindow(wid, g.x, g.y, g.width, g.height);
            }, RESIZE_THROTTLE_MS);
          },
          onResizeEnd: (finalRect) => {
            if (resizeThrottleTimer) {
              clearTimeout(resizeThrottleTimer);
              resizeThrottleTimer = 0;
            }
            const g = fromOuterRect(finalRect, dec);
            console.log(TAG, "onResizeEnd", { finalRect, geom: g });
            resizeRenderer(wid, g.width, g.height);
            sendConfigureWindow(wid, g.x, g.y, g.width, g.height);
            sendBufferRefresh(wid);
            setTimeout(() => sendBufferRefresh(wid), 150);
            setTimeout(() => sendBufferRefresh(wid), 400);
            setTimeout(() => hideTransition(), 650);
          },
        },
      },
    );

    onCleanup(() => {
      console.log(TAG, "onCleanup — teardown");
      canvasEl.removeEventListener("pointerdown", onCanvasPointerDown);
      canvasEl.removeEventListener("pointermove", onCanvasPointerMove);
      canvasEl.removeEventListener("wheel", onCanvasWheel);
      canvasEl.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerdown", onGlobalPointerDown, true);
      document.removeEventListener("pointermove", onDocumentPointerMove);
      document.removeEventListener("pointerup", onDocumentPointerUp);
      if (transitionHideTimer) clearTimeout(transitionHideTimer);
      unregisterWindowCanvas(wid);
      teardown();
    });
  });

  const handleHeaderClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest?.(".windowbtn")) return;
    const w = win();
    if (w && !(w.minimized ?? false)) {
      focusWindow(props.wid);
      raiseWindow(props.wid);
    }
  };

  const handleHeaderDblClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest?.(".windowbtn")) return;
    if (resizable()) toggleMaximized();
  };

  const handleClose = () => {
    if (props.onClose) {
      props.onClose(props.wid);
    } else {
      sendCloseWindow(props.wid);
    }
  };

  const toggleMaximized = () => {
    const w = win();
    if (!w || w.isDesktop || w.overrideRedirect || w.tray) return;
    /* Send Alt+F10 to the WM and wait for metadata.maximized to avoid configure_window races. */
    raiseWindow(props.wid);
    focusWindow(props.wid);
    const sendKey = (keyname: string, pressed: boolean, mods: string[], keyval: number, keycode: number) => {
      sendPacket([
        PACKET_TYPES.key_action,
        props.wid,
        keyname,
        pressed,
        mods,
        keyval,
        "",
        keycode,
        0,
      ] as unknown as ConfigureWindowPacket);
    };
    setTimeout(() => {
      sendKey("Alt_L", true, [], 65513, 64);
      sendKey("F10", true, ["mod1"], 65479, 76);
      sendKey("F10", false, ["mod1"], 65479, 76);
      sendKey("Alt_L", false, [], 65513, 64);
    }, 50);
    setTimeout(() => sendBufferRefresh(props.wid), 400);
  };

  const outer = () => {
    const w = win();
    if (!w) return { x: 0, y: 0, width: 0, height: 0 };
    if (w.isDesktop) {
      const vp = viewportSize();
      return { x: 0, y: 0, width: vp.w, height: vp.h };
    }
    return toOuterRect(w.x, w.y, w.width, w.height, decorated());
  };

  const zIndex = () => {
    const w = win();
    if (!w) return 0;
    if (w.isDesktop) return 1;
    const layer = w.stackingLayer ?? 0;
    let z = 5000 + layer;
    if (w.tray) return 0;
    if (w.overrideRedirect) return 30000;
    if (props.focused) z += 2500;
    return z;
  };

  const classes = () => {
    const w = win();
    const c = ["window-frame"];
    if (w?.isDesktop) c.push("desktop-window");
    if (props.focused) c.push("windowinfocus");
    if (w?.overrideRedirect) c.push("override-redirect");
    if (w?.tray) c.push("tray");
    if (w?.maximized) c.push("maximized");
    if (resizable() || decorated()) c.push("border");
    (w?.windowType ?? []).forEach((t) => c.push(`window-${t}`));
    return c.join(" ");
  };

  const handlePointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement)?.closest?.(".windowbtn")) return;
    focusWindow(props.wid);
    raiseWindow(props.wid);
  };

  return (
    <div
      ref={containerEl}
      class={classes()}
      data-wid={props.wid}
      onPointerDown={handlePointerDown}
      style={{
        position: "absolute",
        left: `${outer().x}px`,
        top: `${outer().y}px`,
        width: `${outer().width}px`,
        height: `${outer().height}px`,
        "z-index": zIndex(),
        display: win()?.minimized ? "none" : undefined,
      }}
    >
      {decorated() && (
        <div
          ref={el => (headerEl = el)}
          class="windowhead"
          onClick={handleHeaderClick}
          onDblClick={handleHeaderDblClick}
          role="button"
          tabIndex={-1}
        >
          {win()?.iconDataUrl
            ? <img class="windowicon" src={win()!.iconDataUrl} alt="" />
            : <span class="windowicon" />
          }
          <span class="windowtitle">{win()?.title ?? ""}</span>
          <Show when={win()?.appHint === "terminal"}>
            <TerminalClipboardHint />
          </Show>
          {resizable() && (
            <span class="windowbuttons">
              <span
                class="windowbtn windowbtn-minimize"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  minimizeWindow(props.wid);
                }}
                role="button"
                title="Minimize"
              >
                {"\u2013"}
              </span>
              <span
                class="windowbtn windowbtn-maximize"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  toggleMaximized();
                }}
                role="button"
                title={win()?.maximized ? "Restore" : "Maximize"}
              >
                {win()?.maximized ? "\u25A1" : "\u2610"}
              </span>
              <span
                class="windowbtn windowbtn-close"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose();
                }}
                role="button"
              >
                ×
              </span>
            </span>
          )}
        </div>
      )}
      <div class="window-content">
        <canvas
          ref={canvasEl}
          class="window-canvas"
        />
        <div
          class={`resize-overlay${showResizeTransition() ? " active" : ""}`}
        >
          <div class="resize-overlay-card">
            <div class="resize-overlay-spinner">
              <div class="resize-overlay-spinner__track" />
              <div class="resize-overlay-spinner__ring" />
            </div>
            <p class="resize-overlay-text">{transitionLabel()}</p>
          </div>
        </div>
        <Show when={win()?.isDesktop && desktopLoading()}>
          <div class="desktop-loading-overlay">
            <div class="desktop-loading-blob desktop-loading-blob--1" />
            <div class="desktop-loading-blob desktop-loading-blob--2" />
            <div class="desktop-loading-card">
              <div class="desktop-loading-spinner">
                <div class="desktop-loading-spinner__track" />
                <div class="desktop-loading-spinner__ring" />
              </div>
              <p class="desktop-loading-text">Loading desktop session…</p>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
