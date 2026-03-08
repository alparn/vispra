/*
 * Author: Ali Parnan
 *
 * Window frame with header bar, canvas, and native drag/resize.
 */

import type { Component } from "solid-js";
import { onMount, onCleanup } from "solid-js";
import {
  windows,
  focusWindow,
  raiseWindow,
  updateWindowGeometry,
  removeWindow,
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

const HEADER_HEIGHT = 30;
const BORDER_WIDTH = 1;

export interface WindowFrameProps {
  wid: number;
  focused: boolean;
  onClose?: (wid: number) => void;
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

export const WindowFrame: Component<WindowFrameProps> = (props) => {
  const win = (): WindowState | undefined => windows()[props.wid];

  const decorated = () => {
    const w = win();
    if (!w) return false;
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
    if (w.overrideRedirect || w.tray) return false;
    const types = w.windowType ?? [];
    if (types.length === 0) return true;
    return types.some((t) =>
      ["NORMAL", "DIALOG", "UTILITY"].includes(t),
    );
  };

  let containerEl!: HTMLDivElement;
  let headerEl!: HTMLDivElement;
  let canvasEl!: HTMLCanvasElement;
  let overlayEl!: HTMLDivElement;

  onMount(() => {
    const wid = props.wid;
    const TAG = `[WindowFrame wid=${wid}]`;

    if (!containerEl) {
      console.error(TAG, "onMount: containerEl is null!");
      return;
    }

    const screenEl = document.getElementById("screen");
    const containment = screenEl;

    const dec = decorated();
    const res = resizable();
    const dragHandle = dec && headerEl ? headerEl : containerEl;

    const w = win();
    console.log(TAG, "onMount setup", {
      decorated: dec,
      resizable: res,
      hasHeaderEl: !!headerEl,
      dragHandleIsHeader: dragHandle === headerEl,
      dragHandleIsContainer: dragHandle === containerEl,
      windowType: w?.windowType,
      overrideRedirect: w?.overrideRedirect,
      tray: w?.tray,
    });

    const getRect = (): DragResizeRect => {
      const w = win();
      if (!w) return { x: 0, y: 0, width: 100, height: 100 };
      return toOuterRect(w.x, w.y, w.width, w.height, dec);
    };

    let resizeThrottleTimer = 0;
    const RESIZE_THROTTLE_MS = 100;

    const commitRect = (outerRect: DragResizeRect): void => {
      const geom = fromOuterRect(outerRect, dec);
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

    const mouseWin: MouseWindow = {
      wid,
      canvas: canvasEl,
      get_internal_geometry() {
        const w = win();
        return { x: w?.x ?? 0, y: w?.y ?? 0, w: w?.width ?? 0, h: w?.height ?? 0 };
      },
    };

    let mouseTracking = false;

    const onCanvasMouseDown = (e: MouseEvent) => {
      console.log(TAG, "MOUSE DOWN button=", e.button, "clientX=", e.clientX, "clientY=", e.clientY, "target=", (e.target as HTMLElement)?.tagName);
      mouseTracking = true;
      document.addEventListener("mousemove", onDocumentMouseMove);
      document.addEventListener("mouseup", onDocumentMouseUp);
      forwardMouseEvent("down", e, mouseWin);
    };
    const onDocumentMouseUp = (e: MouseEvent) => {
      console.log(TAG, "MOUSE UP button=", e.button, "clientX=", e.clientX, "clientY=", e.clientY);
      mouseTracking = false;
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("mouseup", onDocumentMouseUp);
      forwardMouseEvent("up", e, mouseWin);
    };
    const onCanvasMouseMove = (e: MouseEvent) => {
      if (!mouseTracking) forwardMouseEvent("move", e, mouseWin);
    };
    const onDocumentMouseMove = (e: MouseEvent) => {
      forwardMouseEvent("move", e, mouseWin);
    };
    const onCanvasWheel = (e: WheelEvent) => {
      console.log(TAG, "WHEEL deltaX=", e.deltaX, "deltaY=", e.deltaY);
      forwardMouseEvent("wheel", e, mouseWin);
      e.preventDefault();
    };

    canvasEl.addEventListener("mousedown", onCanvasMouseDown);
    canvasEl.addEventListener("mousemove", onCanvasMouseMove);
    canvasEl.addEventListener("wheel", onCanvasWheel, { passive: false });

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
          onResizeStart: () => {
            raiseWindow(wid);
            focusWindow(wid);
            if (overlayEl) overlayEl.classList.add("active");
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
            resizeRenderer(wid, g.width, g.height);
            sendConfigureWindow(wid, g.x, g.y, g.width, g.height);
            sendBufferRefresh(wid);
            setTimeout(() => sendBufferRefresh(wid), 150);
            setTimeout(() => sendBufferRefresh(wid), 400);
            setTimeout(() => {
              if (overlayEl) overlayEl.classList.remove("active");
            }, 350);
          },
        },
      },
    );

    onCleanup(() => {
      console.log(TAG, "onCleanup — teardown");
      canvasEl.removeEventListener("mousedown", onCanvasMouseDown);
      canvasEl.removeEventListener("mousemove", onCanvasMouseMove);
      canvasEl.removeEventListener("wheel", onCanvasWheel);
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("mouseup", onDocumentMouseUp);
      unregisterWindowCanvas(wid);
      teardown();
    });
  });

  const handleHeaderClick = () => {
    const w = win();
    if (w && !(w.minimized ?? false)) {
      focusWindow(props.wid);
      raiseWindow(props.wid);
    }
  };

  const handleClose = () => {
    if (props.onClose) {
      props.onClose(props.wid);
    } else {
      removeWindow(props.wid);
    }
  };

  const outer = () => {
    const w = win();
    if (!w) return { x: 0, y: 0, width: 0, height: 0 };
    return toOuterRect(w.x, w.y, w.width, w.height, decorated());
  };

  const zIndex = () => {
    const w = win();
    if (!w) return 0;
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
    if (props.focused) c.push("windowinfocus");
    if (w?.overrideRedirect) c.push("override-redirect");
    if (w?.tray) c.push("tray");
    if (resizable() || decorated()) c.push("border");
    (w?.windowType ?? []).forEach((t) => c.push(`window-${t}`));
    return c.join(" ");
  };

  const handlePointerDown = () => {
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
      }}
    >
      {decorated() && (
        <div
          ref={el => (headerEl = el)}
          class="windowhead"
          onClick={handleHeaderClick}
          role="button"
          tabIndex={-1}
        >
          <span class="windowicon" />
          <span class="windowtitle">{win()?.title ?? ""}</span>
          {resizable() && (
            <span class="windowbuttons">
              <span
                class="windowbtn windowbtn-close"
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
        <div ref={overlayEl} class="resize-overlay" />
      </div>
    </div>
  );
};
