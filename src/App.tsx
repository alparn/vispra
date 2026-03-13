import type { Component } from "solid-js";
import { createEffect } from "solid-js";
import "./styles/client.css";
import { Screen } from "./ui/Screen";
import { LoginOverlay } from "./ui/LoginOverlay";
import { ProgressOverlay } from "./ui/ProgressOverlay";
import { ConnectOverlay } from "./ui/ConnectOverlay";
import { Notification } from "./ui/Notification";
import { WindowPreview } from "./ui/WindowPreview";
import { SessionInfo } from "./ui/SessionInfo";
import { VirtualKeyboard } from "./ui/VirtualKeyboard";
import { PerformancePanel } from "./ui/PerformancePanel";
import {
  loginVisible,
  loginHeading,
  resolveLogin,
  connectOverlayVisible,
  hideConnectOverlay,
} from "@/store";
import { focusedWid, windows } from "@/store/windows";
import type { ConnectOptions } from "./client";

let connectCallback: ((options: ConnectOptions) => void) | null = null;

export function setConnectCallback(cb: (options: ConnectOptions) => void): void {
  connectCallback = cb;
}

const DEFAULT_TITLE = "Visulox";

const App: Component = () => {
  createEffect(() => {
    const wid = focusedWid();
    const wins = windows();
    const win = wid ? wins[wid] : undefined;
    const title = win?.title?.trim();
    document.title = title ? `${title} — Visulox` : DEFAULT_TITLE;
  });

  const handleConnect = (options: ConnectOptions) => {
    hideConnectOverlay();
    connectCallback?.(options);
  };

  return (
    <div id="app-root">
      <Screen />
      <ConnectOverlay
        visible={connectOverlayVisible()}
        onConnect={handleConnect}
        onCancel={() => hideConnectOverlay()}
      />
      <LoginOverlay
        visible={loginVisible()}
        heading={loginHeading()}
        onConnect={(password) => resolveLogin(password)}
        onCancel={() => resolveLogin(null)}
      />
      <ProgressOverlay />
      <Notification />
      <WindowPreview />
      <SessionInfo />
      <VirtualKeyboard />
      <PerformancePanel />
    </div>
  );
};

export default App;
