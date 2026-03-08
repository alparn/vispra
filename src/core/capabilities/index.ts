/*
 * Author: Ali Parnan
 */

export {
  getDPI,
  getScreenSizes,
  getMonitor,
  getMonitors,
  getDisplayCaps,
  type MonitorGeometry,
  type Workarea,
  type MonitorInfo,
  type ScreenSize,
  type DisplayCaps,
} from "./display";

export {
  METADATA_SUPPORTED,
  FILE_CHUNKS_SIZE,
  RGB_FORMATS,
  CLIENT_VERSION,
  CLIENT_REVISION,
  CLIENT_LOCAL_MODIFICATIONS,
  CLIENT_BRANCH,
  getKeycodes,
  resolveKeyboardLayout,
  getEncodingCaps,
  getAudioCaps,
  getPointerCaps,
  getClipboardCaps,
  getKeymapCaps,
  getFileCaps,
  getDigests,
  getNetworkCaps,
  getBuildCaps,
  getPlatformCaps,
  buildDisplayCaps,
  updateCapabilities,
  makeHelloBase,
  makeHello,
  type EncodingOptions,
  type CapabilitiesBuilderInput,
} from "./builder";
