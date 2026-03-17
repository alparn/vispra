/*
 * Author: Ali Parnan
 *
 * Native Pointer Events for window drag and resize.
 * Replaces jQuery UI draggable/resizable (~19.000 Zeilen).
 */

import { MOVERESIZE_DIRECTION_JS_NAME } from "@/core/constants/move-resize";

/** Resize handle: n, e, s, w, ne, se, sw, nw */
export type ResizeHandle =
  | "n"
  | "e"
  | "s"
  | "w"
  | "ne"
  | "se"
  | "sw"
  | "nw";

/** Geometry in screen coordinates (outer box including decoration). */
export interface DragResizeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DragResizeConstraints {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface DragResizeCallbacks {
  onMoveStart?: () => void;
  onMove?: (dx: number, dy: number) => void;
  onMoveEnd?: (newRect: DragResizeRect) => void;
  onResizeStart?: (handle: ResizeHandle) => void;
  onResize?: (handle: ResizeHandle, newRect: DragResizeRect) => void;
  onResizeEnd?: (newRect: DragResizeRect) => void;
}

const HANDLE_SIZE = 7;
const HANDLE_OVERLAP = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Setup native Pointer Events for drag and resize on a window element.
 * The dragHandle is the element that initiates dragging (e.g. header bar).
 * Resize handles are created as overlay divs at the edges/corners.
 *
 * cancel: CSS selector whose matches should NOT start a drag (e.g. "canvas").
 */
const SETUP_KEY = "__dragResizeTeardown";

export function setupDragResize(
  container: HTMLElement,
  dragHandle: HTMLElement,
  getRect: () => DragResizeRect,
  setRect: (rect: DragResizeRect) => void,
  options: {
    enabled?: boolean;
    draggable?: boolean;
    resizable?: boolean;
    containment?: HTMLElement | null;
    constraints?: DragResizeConstraints;
    callbacks?: DragResizeCallbacks;
    cancel?: string;
  } = {},
): () => void {
  // Prevent double-setup on the same DOM element (Solid.js re-renders)
  const el = container as unknown as Record<string, unknown>;
  const prev = el[SETUP_KEY] as (() => void) | undefined;
  if (prev) {
    console.warn(`[drag-resize] teardown previous setup on`, container.dataset.wid ?? container);
    prev();
  }

  const {
    enabled = true,
    draggable = true,
    resizable = true,
    containment = null,
    constraints = {},
    callbacks = {},
    cancel,
  } = options;

  let isDragging = false;
  let isResizing = false;
  let activeHandle: ResizeHandle | null = null;
  let startX = 0;
  let startY = 0;
  let startRect: DragResizeRect = { x: 0, y: 0, width: 0, height: 0 };
  let currentRect: DragResizeRect = { x: 0, y: 0, width: 0, height: 0 };

  const { minWidth = 50, minHeight = 30, maxWidth, maxHeight } = constraints;

  function getContainmentBounds(): { x: number; y: number; w: number; h: number } {
    if (!containment) {
      return { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity };
    }
    return { x: 0, y: 0, w: containment.clientWidth, h: containment.clientHeight };
  }

  function roundRect(rect: DragResizeRect): DragResizeRect {
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function applyConstraints(rect: DragResizeRect): DragResizeRect {
    let { x, y, width, height } = rect;
    width = clamp(width, minWidth, maxWidth ?? Infinity);
    height = clamp(height, minHeight, maxHeight ?? Infinity);
    return { x, y, width, height };
  }

  function applyContainment(rect: DragResizeRect): DragResizeRect {
    const bounds = getContainmentBounds();
    let { x, y, width, height } = rect;
    x = clamp(x, bounds.x, bounds.x + bounds.w - width);
    y = clamp(y, bounds.y, bounds.y + bounds.h - height);
    return { x, y, width, height };
  }

  function applyStyle(rect: DragResizeRect): void {
    container.style.left = `${rect.x}px`;
    container.style.top = `${rect.y}px`;
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
  }

  const TAG = `[drag-resize wid=${container.dataset.wid ?? "?"}]`;
  let resizeMoveLogCount = 0;

  function tryCapture(el: HTMLElement, pointerId: number): void {
    try {
      el.setPointerCapture(pointerId);
      console.debug(TAG, "setPointerCapture OK, pointerId=", pointerId);
    } catch (err) {
      console.warn(TAG, "setPointerCapture FAILED:", err);
    }
  }

  function matchesCancel(target: HTMLElement): boolean {
    if (!cancel) return false;
    return target.matches(cancel) || target.closest(cancel) !== null;
  }

  console.log(TAG, "setupDragResize() called", {
    enabled, draggable, resizable,
    cancel,
    containerTag: container.tagName, containerClass: container.className,
    dragHandleTag: dragHandle.tagName, dragHandleClass: dragHandle.className,
    dragHandleSame: dragHandle === container,
    containment: containment?.id ?? containment?.tagName ?? null,
    resizeHandlesCount: resizable ? HANDLES.length : 0,
  });

  function handlePointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const targetDesc = `<${target.tagName.toLowerCase()}.${target.className}>`;
    const hasResizeHandle = !!target.dataset?.resizeHandle;
    const inHandlesOverlay = target.closest(".drag-resize-handles");

    if (inHandlesOverlay && !hasResizeHandle) {
      console.log(TAG, "pointerdown IN overlay but NOT on handle", {
        target: targetDesc,
        parent: target.parentElement?.className,
      });
    }

    if (!enabled) {
      console.debug(TAG, "pointerdown IGNORED: enabled=false, target=", targetDesc);
      return;
    }
    if (e.button !== 0) {
      console.debug(TAG, "pointerdown IGNORED: button=", e.button, "target=", targetDesc);
      return;
    }
    if (target.closest(".windowbtn")) {
      return;
    }

    const handle = target.dataset?.resizeHandle as ResizeHandle | undefined;

    if (handle) {
      if (!resizable) {
        console.warn(TAG, "pointerdown on resize handle", handle, "IGNORED: resizable=false");
        return;
      }
      const rect = getRect();
      console.log(TAG, "RESIZE START", {
        handle,
        clientX: e.clientX,
        clientY: e.clientY,
        startRect: rect,
        target: target.className,
        targetParent: target.parentElement?.className,
      });
      isResizing = true;
      activeHandle = handle;
      startX = e.clientX;
      startY = e.clientY;
      startRect = { ...getRect() };
      currentRect = { ...startRect };
      callbacks.onResizeStart?.(handle);
      tryCapture(target, e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!draggable) {
      console.debug(TAG, "pointerdown IGNORED: draggable=false, target=", targetDesc);
      return;
    }

    if (matchesCancel(target)) {
      console.debug(TAG, "pointerdown IGNORED: matches cancel selector", `"${cancel}"`, "target=", targetDesc);
      return;
    }

    const onHandle = target === dragHandle;
    const insideHandle = dragHandle.contains(target);
    if (!onHandle && !insideHandle) {
      console.debug(TAG, "pointerdown IGNORED: target not on dragHandle.",
        "target=", targetDesc,
        "dragHandle=", `<${dragHandle.tagName.toLowerCase()}.${dragHandle.className}>`,
        "target===dragHandle:", onHandle,
        "dragHandle.contains(target):", insideHandle,
      );
      return;
    }

    console.log(TAG, "DRAG START at", e.clientX, e.clientY, "target=", targetDesc);
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startRect = { ...getRect() };
    currentRect = { ...startRect };
    console.debug(TAG, "startRect:", JSON.stringify(startRect));
    callbacks.onMoveStart?.();
    tryCapture(dragHandle, e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isDragging && !isResizing) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (isResizing && activeHandle) {
      let { x, y, width, height } = startRect;
      const h = activeHandle;

      if (h.includes("e")) width += dx;
      if (h.includes("w")) { width -= dx; x += dx; }
      if (h.includes("s")) height += dy;
      if (h.includes("n")) { height -= dy; y += dy; }

      let rect = applyConstraints({ x, y, width, height });
      rect = applyContainment(rect);
      rect = roundRect(rect);
      currentRect = rect;
      applyStyle(rect);
      if (resizeMoveLogCount++ < 3 || resizeMoveLogCount % 20 === 0) {
        console.log(TAG, "RESIZE MOVE", { handle: h, dx, dy, rect });
      }
      callbacks.onResize?.(activeHandle, rect);
    } else if (isDragging) {
      let rect = {
        x: startRect.x + dx,
        y: startRect.y + dy,
        width: startRect.width,
        height: startRect.height,
      };
      rect = applyContainment(rect);
      rect = roundRect(rect);
      currentRect = rect;
      applyStyle(rect);
      callbacks.onMove?.(dx, dy);
    }

    e.preventDefault();
  }

  function syncFromStore(): void {
    const storeRect = getRect();
    applyStyle(storeRect);
  }

  function handlePointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (isResizing) {
      console.log(TAG, "RESIZE END", {
        finalRect: currentRect,
        startRect,
        target: (e.target as HTMLElement)?.tagName,
      });
      resizeMoveLogCount = 0;
      isResizing = false;
      setRect(currentRect);
      syncFromStore();
      callbacks.onResizeEnd?.(currentRect);
      activeHandle = null;
    } else if (isDragging) {
      console.log(TAG, "DRAG END rect:", JSON.stringify(currentRect));
      isDragging = false;
      setRect(currentRect);
      syncFromStore();
      callbacks.onMoveEnd?.(currentRect);
    }
  }

  function handlePointerCancel(): void {
    if (isDragging || isResizing) {
      console.warn(TAG, "pointercancel — reverting to startRect:", JSON.stringify(startRect));
      setRect(startRect);
      applyStyle(startRect);
    }
    isDragging = false;
    isResizing = false;
    activeHandle = null;
  }

  container.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerup", handlePointerUp, true);
  document.addEventListener("pointercancel", handlePointerCancel, true);

  if (resizable) {
    createResizeHandles(container);
  }

  const teardown = () => {
    container.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    document.removeEventListener("pointercancel", handlePointerCancel, true);
    removeResizeHandles(container);
    delete (container as unknown as Record<string, unknown>)[SETUP_KEY];
  };

  (container as unknown as Record<string, unknown>)[SETUP_KEY] = teardown;
  return teardown;
}

const HANDLES: ResizeHandle[] = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

function createResizeHandles(container: HTMLElement): void {
  const wid = container.dataset?.wid ?? "?";
  const overlay = document.createElement("div");
  overlay.className = "drag-resize-handles";
  overlay.dataset.wid = String(wid);
  overlay.style.cssText = `
    position: absolute;
    inset: -${HANDLE_OVERLAP}px;
    pointer-events: none;
    z-index: 10;
  `;

  const handleStyle: Record<string, string> = {
    position: "absolute",
    "pointer-events": "auto",
    "touch-action": "none",
  };

  for (const h of HANDLES) {
    const div = document.createElement("div");
    div.className = `drag-resize-handle drag-resize-${h}`;
    div.dataset.resizeHandle = h;
    Object.assign(div.style, handleStyle, getHandlePosition(h));
    overlay.appendChild(div);
  }

  container.style.position = "absolute";
  container.appendChild(overlay);
  const handleCount = overlay.querySelectorAll("[data-resize-handle]").length;
  console.log(`[drag-resize wid=${wid}] createResizeHandles: ${handleCount} handles, overlay parent=`, container.tagName, "children=", container.children.length);
}

function getHandlePosition(handle: ResizeHandle): Record<string, string> {
  const s = HANDLE_SIZE;
  const common: Record<string, string> = {
    cursor: `${handle}-resize`,
  };
  switch (handle) {
    case "n":
      return { ...common, top: "0", left: `${s}px`, right: `${s}px`, height: `${s}px` };
    case "s":
      return { ...common, bottom: "0", left: `${s}px`, right: `${s}px`, height: `${s}px` };
    case "e":
      return { ...common, top: `${s}px`, right: "0", bottom: `${s}px`, width: `${s}px` };
    case "w":
      return { ...common, top: `${s}px`, left: "0", bottom: `${s}px`, width: `${s}px` };
    case "ne":
      return { ...common, top: "0", right: "0", width: `${s}px`, height: `${s}px` };
    case "se":
      return { ...common, bottom: "0", right: "0", width: `${s}px`, height: `${s}px` };
    case "sw":
      return { ...common, bottom: "0", left: "0", width: `${s}px`, height: `${s}px` };
    case "nw":
      return { ...common, top: "0", left: "0", width: `${s}px`, height: `${s}px` };
    default:
      return common;
  }
}

function removeResizeHandles(container: HTMLElement): void {
  const overlay = container.querySelector(".drag-resize-handles");
  overlay?.remove();
}

/**
 * Map Xpra MOVERESIZE_* direction constant to ResizeHandle.
 */
export function moveresizeDirectionToHandle(direction: number): ResizeHandle | null {
  const name = MOVERESIZE_DIRECTION_JS_NAME[direction];
  return (name as ResizeHandle) ?? null;
}
