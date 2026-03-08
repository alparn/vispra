/*
 * Author: Ali Parnan
 */

import { describe, it, expect } from "vitest";
import {
  clientToServer,
  pointerLockDelta,
  getMouseButton,
  type CoordinateEvent,
} from "../coordinates";

describe("clientToServer", () => {
  it("transforms client coords with scroll and scale", () => {
    const event: CoordinateEvent = { clientX: 100, clientY: 200 };
    const result = clientToServer(event, {
      scale: 1,
      scrollLeft: 50,
      scrollTop: 30,
      pointerLocked: false,
      lastX: null,
      lastY: null,
    });
    expect(result.x).toBe(150);
    expect(result.y).toBe(230);
    expect(result.newLastX).toBe(150);
    expect(result.newLastY).toBe(230);
  });

  it("applies scale factor", () => {
    const event: CoordinateEvent = { clientX: 100, clientY: 200 };
    const result = clientToServer(event, {
      scale: 2,
      scrollLeft: 0,
      scrollTop: 0,
      pointerLocked: false,
      lastX: null,
      lastY: null,
    });
    expect(result.x).toBe(200);
    expect(result.y).toBe(400);
  });

  it("accumulates movement in pointer lock mode", () => {
    const event: CoordinateEvent = {
      clientX: 0,
      clientY: 0,
      movementX: 10,
      movementY: -5,
    };
    const result = clientToServer(event, {
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
      pointerLocked: true,
      lastX: 100,
      lastY: 50,
    });
    expect(result.x).toBe(110);
    expect(result.y).toBe(45);
    expect(result.newLastX).toBe(110);
    expect(result.newLastY).toBe(45);
  });

  it("falls back to last position on NaN (bug #854)", () => {
    const event = { clientX: NaN, clientY: NaN } as CoordinateEvent;
    const result = clientToServer(event, {
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
      pointerLocked: false,
      lastX: 42,
      lastY: 99,
    });
    expect(result.x).toBe(42);
    expect(result.y).toBe(99);
  });

  it("returns 0,0 when NaN and no last position", () => {
    const event = { clientX: NaN, clientY: NaN } as CoordinateEvent;
    const result = clientToServer(event, {
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
      pointerLocked: false,
      lastX: null,
      lastY: null,
    });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

describe("pointerLockDelta", () => {
  it("extracts movementX and movementY", () => {
    const delta = pointerLockDelta({ movementX: 15, movementY: -20 });
    expect(delta.x).toBe(15);
    expect(delta.y).toBe(-20);
  });

  it("defaults to 0 when movement missing", () => {
    const delta = pointerLockDelta({});
    expect(delta.x).toBe(0);
    expect(delta.y).toBe(0);
  });
});

describe("getMouseButton", () => {
  it("uses which when available (Gecko/WebKit)", () => {
    expect(getMouseButton({ which: 1 })).toBe(1);
    expect(getMouseButton({ which: 2 })).toBe(2);
    expect(getMouseButton({ which: 0 })).toBe(0);
  });

  it("uses button+1 when which unavailable (IE fallback)", () => {
    expect(getMouseButton({ button: 0 })).toBe(1);
    expect(getMouseButton({ button: 1 })).toBe(2);
    expect(getMouseButton({ button: 2 })).toBe(3);
  });

  it("prefers which over button", () => {
    expect(getMouseButton({ which: 1, button: 2 })).toBe(1);
  });

  it("returns 0 when no button info", () => {
    expect(getMouseButton({})).toBe(0);
  });
});
