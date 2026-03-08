/*
 * Author: Ali Parnan
 */

/**
 * Solid.js Stores — Central export for Phase 6a state management.
 */

export {
  connectionStore,
  isConnected,
  setConnecting,
  setConnected,
  setReconnecting,
  setReconnectAttemptCount,
  clearReconnecting,
  setError,
  setDisconnected,
  setConnectionProgress,
  progress,
  setSessionInfo,
  updateServerInfo,
  resetConnectionStore,
  type ConnectionState,
  type ConnectionProgress,
  type ServerInfo,
} from "./connection";

export {
  windowsStore,
  windows,
  focusedWid,
  addWindow,
  removeWindow,
  updateWindow,
  updateWindowGeometry,
  setFocusedWindow,
  clearAllWindows,
  getWindow,
  getWindowIds,
  getWindowCount,
  getWindowsSortedByStacking,
  raiseWindow,
  type WindowState,
} from "./windows";

export {
  settingsStore,
  updateSettings,
  loadSettingsFromParams,
  resetSettings,
  getEncodingOptions,
  type ClientSettings,
  type ConnectionSettings,
  type FeatureSettings,
  type DisplaySettings,
  type ReconnectSettings,
  type TimeoutSettings,
  type InputSettings,
} from "./settings";

export {
  keyboardStore,
  getCaptureKeyboardRequested,
  getKeyboardState,
  getKeyboardLayout,
  getKeyLayout,
  isCaptureActive,
  requestCaptureKeyboard,
  setKeyboardControllerState,
  setServerKeyboardLayout,
  setResolvedKeyLayout,
} from "./keyboard";

export {
  audioStore,
  getAudioEnabled,
  getAudioState,
  getAudioCodecs,
  getAudioFramework,
  getAudioCodec,
  isMediasourceEnabled,
  isAuroraEnabled,
  isHttpStreamEnabled,
  enableAudio,
  setAudioPlaybackState,
  setAudioCodecList,
  setActiveAudioFramework,
  setActiveAudioCodec,
  setAudioBackendFlags,
  resetAudio,
  type AudioFramework,
} from "./audio";

export {
  uiStore,
  loginVisible,
  loginHeading,
  sessionInfoVisible,
  virtualKeyboardVisible,
  windowPreviewVisible,
  showLogin,
  hideLogin,
  showLoginWithPrompt,
  resolveLogin,
  showSessionInfo,
  hideSessionInfo,
  toggleSessionInfo,
  showVirtualKeyboard,
  hideVirtualKeyboard,
  toggleVirtualKeyboard,
  showWindowPreview,
  hideWindowPreview,
  toggleWindowPreview,
} from "./ui";

export {
  notificationsStore,
  addNotification,
  removeNotification,
  closeNotification,
  clearAllNotifications,
  type NotificationItem,
} from "./notifications";

export {
  sessionInfoStore,
  updateSessionInfo,
  clearSessionInfo,
  type SessionInfoData,
} from "./session-info";

export {
  windowCanvasStore,
  registerWindowCanvas,
  unregisterWindowCanvas,
  getWindowCanvas,
} from "./window-canvases";

export {
  sendPacket,
  registerPacketSender,
  unregisterPacketSender,
  resizeRenderer,
  registerRendererResizer,
  unregisterRendererResizer,
  focusWindow,
  registerMouseForwarder,
  unregisterMouseForwarder,
  forwardMouseEvent,
  type MouseWindow,
} from "./client-bridge";
