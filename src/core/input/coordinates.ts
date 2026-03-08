/*
 * Author: Ali Parnan
 */

/**
 * 2D point in screen or window coordinates.
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Options for transforming client coordinates to server coordinates.
 */
export interface ClientToServerOptions {
  /** Scale factor (e.g. for HiDPI). */
  scale: number;
  /** Document scroll offset X. */
  scrollLeft: number;
  /** Document scroll offset Y. */
  scrollTop: number;
  /** Whether pointer lock is active (use movementX/Y instead of clientX/Y). */
  pointerLocked: boolean;
  /** Last known X position (for pointer lock accumulation and NaN fallback). */
  lastX: number | null;
  /** Last known Y position (for pointer lock accumulation and NaN fallback). */
  lastY: number | null;
}

/**
 * Result of clientToServer transformation.
 */
export interface ClientToServerResult {
  /** Server X coordinate. */
  x: number;
  /** Server Y coordinate. */
  y: number;
  /** Updated last X for next call (pointer lock accumulation). */
  newLastX: number;
  /** Updated last Y for next call (pointer lock accumulation). */
  newLastY: number;
}

/**
 * Event-like object with client or movement coordinates.
 */
export interface CoordinateEvent {
  clientX: number;
  clientY: number;
  movementX?: number;
  movementY?: number;
}

/**
 * Transforms client/viewport coordinates to server coordinates.
 * Handles scroll offset, scale, pointer lock (movement delta accumulation),
 * and NaN fallback (bug #854).
 */
export function clientToServer(
  event: CoordinateEvent,
  options: ClientToServerOptions,
): ClientToServerResult {
  const { scale, scrollLeft, scrollTop, pointerLocked, lastX, lastY } =
    options;

  let mx: number;
  let my: number;

  if (pointerLocked) {
    mx = event.movementX ?? 0;
    my = event.movementY ?? 0;
  } else {
    mx = event.clientX + scrollLeft;
    my = event.clientY + scrollTop;
  }

  if (scale !== 1) {
    mx = Math.round(mx * scale);
    my = Math.round(my * scale);
  }

  // Fallback for NaN (bug #854 - some events don't provide coordinates)
  if (isNaN(mx) || isNaN(my)) {
    if (lastX !== null && lastY !== null && !isNaN(lastX) && !isNaN(lastY)) {
      mx = lastX;
      my = lastY;
    } else {
      mx = 0;
      my = 0;
    }
  }

  let newLastX: number;
  let newLastY: number;

  if (pointerLocked) {
    const prevX = lastX ?? 0;
    const prevY = lastY ?? 0;
    newLastX = prevX + mx;
    newLastY = prevY + my;
  } else {
    newLastX = mx;
    newLastY = my;
  }

  return {
    x: newLastX,
    y: newLastY,
    newLastX,
    newLastY,
  };
}

/**
 * Extracts movement delta from a pointer lock event.
 * Used when the pointer is locked and only relative movement is available.
 */
export function pointerLockDelta(event: {
  movementX?: number;
  movementY?: number;
}): Point2D {
  return {
    x: event.movementX ?? 0,
    y: event.movementY ?? 0,
  };
}

/**
 * Maps browser mouse button (which/button) to X11 button number (1-based).
 * - Gecko/WebKit/Opera: `which` is 1-based (0 = no button)
 * - IE/Opera fallback: `button` is 0-based, so we add 1
 */
export function getMouseButton(event: {
  which?: number;
  button?: number;
}): number {
  if ("which" in event && typeof event.which === "number") {
    return Math.max(0, event.which);
  }
  if ("button" in event && typeof event.button === "number") {
    return Math.max(0, event.button) + 1;
  }
  return 0;
}
