import { render } from "solid-js/web";
import App, { setConnectCallback } from "./App";
import { XpraClient, type ConnectOptions } from "./client";
import { showConnectOverlay } from "@/store";

const root = document.getElementById("app");
if (!root) throw new Error("Root element #app not found");

render(() => <App />, root);

// ---------------------------------------------------------------------------
// Connection logic — URL params auto-connect OR show ConnectOverlay
// ---------------------------------------------------------------------------

function createClientAndConnect(options: ConnectOptions): void {
  const client = new XpraClient({
    onConnect: () => console.log("[xpra] Connected!"),
    onDisconnect: (r) => console.log("[xpra] Disconnected:", r),
    onNewWindow: (wid, _x, _y, w, h, meta) =>
      console.log(`[xpra] New window wid=${wid} ${w}x${h}`, meta),
    onLostWindow: (wid) => console.log(`[xpra] Lost window wid=${wid}`),
    onProgress: (s, _d, p) => console.log(`[xpra] ${s} ${p}%`),
  });

  client.connect(options);
  (window as unknown as Record<string, unknown>).__xpraClient = client;
}

setConnectCallback(createClientAndConnect);

setTimeout(() => {
  const params = new URLSearchParams(location.search);

  if (params.has("host")) {
    const options: ConnectOptions = {
      host: params.get("host")!,
      port: parseInt(params.get("port") ?? "10000", 10),
      ssl: params.get("ssl") === "true",
      path: params.get("path") || undefined,
      username: params.get("username") || undefined,
      passwords: params.has("password") ? [params.get("password")!] : undefined,
      startNewSession: params.get("session_type") || null,
      sharing: params.get("sharing") === "true",
      steal: params.get("steal") !== "false",
      encryptionKey: params.get("encryption_key") || undefined,
    };
    createClientAndConnect(options);
  } else {
    showConnectOverlay();
  }
}, 100);
