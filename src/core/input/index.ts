/*
 * Author: Ali Parnan
 */

export {
  KeyboardController,
  type KeyboardState,
  type KeyboardControllerOptions,
  type KeyboardLayoutMap,
} from "./keyboard";

export {
  clientToServer,
  pointerLockDelta,
  getMouseButton,
  type Point2D,
  type ClientToServerOptions,
  type ClientToServerResult,
  type CoordinateEvent,
} from "./coordinates";

export {
  MouseHandler,
  type MouseHandlerContext,
  type MouseWindow,
  type MouseEventLike,
  type MousePosition,
  type WindowGeometry,
} from "./mouse";
