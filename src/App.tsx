import type { Component } from "solid-js";
import "./styles/client.css";
import { Screen } from "./ui/Screen";
import { LoginOverlay } from "./ui/LoginOverlay";
import { ProgressOverlay } from "./ui/ProgressOverlay";
import { ConnectOverlay } from "./ui/ConnectOverlay";
import { Notification } from "./ui/Notification";
import { WindowPreview } from "./ui/WindowPreview";
import { SessionInfo } from "./ui/SessionInfo";
import { VirtualKeyboard } from "./ui/VirtualKeyboard";
import {
  loginVisible,
  loginHeading,
  resolveLogin,
  connectOverlayVisible,
  hideConnectOverlay,
} from "@/store";
import type { ConnectOptions } from "./client";

let connectCallback: ((options: ConnectOptions) => void) | null = null;

export function setConnectCallback(cb: (options: ConnectOptions) => void): void {
  connectCallback = cb;
}

const App: Component = () => {
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
    </div>
  );
};

export default App;
