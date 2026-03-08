import type { Component } from "solid-js";
import "./styles/client.css";
import { Screen } from "./ui/Screen";
import { LoginOverlay } from "./ui/LoginOverlay";
import { ProgressOverlay } from "./ui/ProgressOverlay";
import { Notification } from "./ui/Notification";
import { WindowPreview } from "./ui/WindowPreview";
import { SessionInfo } from "./ui/SessionInfo";
import { VirtualKeyboard } from "./ui/VirtualKeyboard";
import {
  loginVisible,
  loginHeading,
  resolveLogin,
} from "@/store";

const App: Component = () => {
  return (
    <div id="app-root">
      <Screen />
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
