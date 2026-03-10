import { render } from "solid-js/web";
import App, { setConnectCallback } from "./App";
import { XpraClient, type ConnectOptions } from "./client";
import { XpraServerAPI, type ServerInfo, type SessionsResponse } from "./core/api";
import { showConnectOverlay } from "@/store";
import { log, warn } from "@/core/utils/logging";

const root = document.getElementById("app");
if (!root) throw new Error("Root element #app not found");

render(() => <App />, root);

// ---------------------------------------------------------------------------
// Connection logic
// ---------------------------------------------------------------------------

function isSameOriginMode(): boolean {
  return window.location.pathname.includes("/cxpra/");
}

function getSessionEndUrl(): string {
  let path = window.location.pathname;
  if (!path.endsWith("connect.html")) {
    path = path.replace(/\/$/, "") + "/connect.html";
  }
  return window.location.origin + path;
}

function createClientAndConnect(options: ConnectOptions): void {
  const client = new XpraClient({
    onConnect: () => console.log("[xpra] Connected!"),
    onDisconnect: (reason) => {
      console.log("[xpra] Disconnected:", reason);
      if (isSameOriginMode()) {
        const url = getSessionEndUrl();
        log("[xpra] Session ended — navigating to:", url);
        window.location.href = url;
      }
    },
    onNewWindow: (wid, _x, _y, w, h, meta) =>
      console.log(`[xpra] New window wid=${wid} ${w}x${h}`, meta),
    onLostWindow: (wid) => console.log(`[xpra] Lost window wid=${wid}`),
    onProgress: (s, _d, p) => console.log(`[xpra] ${s} ${p}%`),
  });

  client.connect(options);
  (window as unknown as Record<string, unknown>).__xpraClient = client;
}

setConnectCallback(createClientAndConnect);

// ---------------------------------------------------------------------------
// URL parameter helpers
// ---------------------------------------------------------------------------

function getParam(params: URLSearchParams, key: string): string | null {
  return params.get(key);
}

function getParamBool(params: URLSearchParams, key: string, fallback = false): boolean {
  if (!params.has(key)) return fallback;
  return params.get(key) === "true";
}

function getParamInt(params: URLSearchParams, key: string, fallback: number): number {
  const val = params.get(key);
  if (val == null) return fallback;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

function buildOptionsFromParams(params: URLSearchParams): ConnectOptions {
  const password = getParam(params, "password");
  const token = getParam(params, "token");
  const passwords: string[] = [];
  if (token) passwords.push(token);
  if (password) passwords.push(password);

  return {
    host: params.get("host")!,
    port: getParamInt(params, "port", 10000),
    ssl: getParamBool(params, "ssl"),
    path: getParam(params, "path") || undefined,
    username: getParam(params, "username") || undefined,
    passwords: passwords.length > 0 ? passwords : undefined,
    startNewSession: getParam(params, "session_type") || null,
    sharing: getParamBool(params, "sharing"),
    steal: getParamBool(params, "steal", true),
    encryptionKey: getParam(params, "encryption_key") || undefined,
  };
}

// ---------------------------------------------------------------------------
// API mode: query server, decide session type, build options automatically
// ---------------------------------------------------------------------------

function resolveSessionType(
  info: ServerInfo | null,
  sessions: SessionsResponse | null,
): string | null {
  if (info?.mode === "seamless" || info?.mode === "desktop" || info?.mode === "shadow") {
    return null;
  }

  const sessionList = sessions ? Object.keys(sessions) : [];
  if (sessionList.length > 0) {
    return null;
  }

  return "start";
}

async function autoConnectViaAPI(params: URLSearchParams): Promise<void> {
  const host = params.get("host")!;
  const port = getParamInt(params, "port", 10000);
  const ssl = getParamBool(params, "ssl");

  const password = getParam(params, "password");
  const token = getParam(params, "token");
  const username = getParam(params, "username") || undefined;
  const authPassword = token || password || undefined;

  const auth = username && authPassword
    ? { username, password: authPassword }
    : undefined;

  log("[autoConnect] API mode — querying server", `${host}:${port}`);

  const api = new XpraServerAPI({ host, port, ssl, auth });

  let info: ServerInfo | null = null;
  let sessions: SessionsResponse | null = null;
  try {
    const result = await api.fetchAll();
    info = result.info;
    sessions = result.sessions;
    log("[autoConnect] Server info:", info, "sessions:", sessions);
  } catch (err) {
    warn("[autoConnect] API query failed, falling back to direct connect:", err);
  }

  const explicitSession = getParam(params, "session_type");
  const startNewSession = explicitSession || resolveSessionType(info, sessions);

  const passwords: string[] = [];
  if (token) passwords.push(token);
  if (password) passwords.push(password);

  const options: ConnectOptions = {
    host,
    port,
    ssl,
    path: getParam(params, "path") || undefined,
    username,
    passwords: passwords.length > 0 ? passwords : undefined,
    startNewSession,
    sharing: getParamBool(params, "sharing"),
    steal: getParamBool(params, "steal", true),
    encryptionKey: getParam(params, "encryption_key") || undefined,
  };

  log("[autoConnect] Connecting with options:", options);
  createClientAndConnect(options);
}

// ---------------------------------------------------------------------------
// autoConnect — entry point: decide mode from URL parameters
// ---------------------------------------------------------------------------

type ConnectMode = "api" | "direct" | "same-origin" | "form";

function detectMode(params: URLSearchParams): ConnectMode {
  if (params.get("mode") === "api" && params.has("host")) {
    return "api";
  }

  if (params.has("host")) {
    return "direct";
  }

  if (params.get("mode") === "form") {
    return "form";
  }

  // Served by xpra/Visulox itself — use the current origin to connect.
  // The URL path (e.g. /cxpra/<uuid>/<host>/<port>/) is forwarded as the
  // WebSocket path so the proxy can route to the correct xpra backend.
  if (!params.has("host") && !params.has("mode")) {
    return "same-origin";
  }

  return "form";
}

async function autoConnect(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mode = detectMode(params);

  log("[autoConnect] Detected mode:", mode);

  switch (mode) {
    case "api":
      await autoConnectViaAPI(params);
      break;

    case "direct": {
      const options = buildOptionsFromParams(params);
      log("[autoConnect] Direct connect with options:", options);
      createClientAndConnect(options);
      break;
    }

    case "same-origin": {
      const password = getParam(params, "password");
      const token = getParam(params, "token");
      const username = getParam(params, "username") || undefined;
      const passwords: string[] = [];
      if (token) passwords.push(token);
      if (password) passwords.push(password);

      const wsPath = window.location.pathname.replace(/index\.html$/, "");

      const options: ConnectOptions = {
        host: window.location.hostname,
        port: parseInt(window.location.port || (window.location.protocol === "https:" ? "443" : "80"), 10),
        ssl: window.location.protocol === "https:",
        path: wsPath,
        username,
        passwords: passwords.length > 0 ? passwords : undefined,
        sharing: getParamBool(params, "sharing"),
        steal: getParamBool(params, "steal", true),
      };

      log("[autoConnect] Same-origin connect with options:", options);
      createClientAndConnect(options);
      break;
    }

    case "form":
    default:
      showConnectOverlay();
      break;
  }
}

setTimeout(() => {
  autoConnect().catch((err) => {
    warn("[autoConnect] Unexpected error:", err);
    showConnectOverlay();
  });
}, 100);
