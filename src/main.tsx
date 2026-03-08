import { render } from "solid-js/web";
import App from "./App";
import { XpraClient } from "./client";

const root = document.getElementById("app");
if (!root) throw new Error("Root element #app not found");

render(() => <App />, root);

// Auto-connect to Xpra server for development/testing
// Delay slightly so the Screen component has mounted and registered canvases
setTimeout(() => {
  const client = new XpraClient({
    onConnect: () => console.log("[xpra] Connected!"),
    onDisconnect: (r) => console.log("[xpra] Disconnected:", r),
    onNewWindow: (wid, _x, _y, w, h, meta) =>
      console.log(`[xpra] New window wid=${wid} ${w}x${h}`, meta),
    onLostWindow: (wid) => console.log(`[xpra] Lost window wid=${wid}`),
    onProgress: (s, _d, p) => console.log(`[xpra] ${s} ${p}%`),
  });

  client.connect({
    host: "localhost",
    port: 10000,
    ssl: false,
  });

  // Expose for DevTools debugging
  (window as unknown as Record<string, unknown>).__xpraClient = client;
}, 100);
