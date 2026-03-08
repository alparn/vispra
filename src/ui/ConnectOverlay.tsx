/*
 * Author: Ali Parnan
 *
 * ConnectOverlay — Connection form for entering server details.
 * Supports manual input of Host/Port/SSL/Session-Type and optional
 * server query via XpraServerAPI (/Info, /Sessions, /Displays).
 */

import type { Component } from "solid-js";
import { createSignal, Show, For } from "solid-js";
import { XpraServerAPI } from "@/core/api";
import type {
  ServerInfo as APIServerInfo,
  SessionsResponse,
  DisplaysResponse,
} from "@/core/api";
import type { ConnectOptions } from "@/client";
import "./ConnectOverlay.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectOverlayProps {
  visible: boolean;
  onConnect: (options: ConnectOptions) => void;
  onCancel: () => void;
}

type SessionType = "" | "start" | "start-desktop" | "shadow";

interface ServerQueryResult {
  info: APIServerInfo | null;
  sessions: SessionsResponse | null;
  displays: DisplaysResponse | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ConnectOverlay: Component<ConnectOverlayProps> = (props) => {
  const [host, setHost] = createSignal("localhost");
  const [port, setPort] = createSignal(10000);
  const [ssl, setSsl] = createSignal(false);
  const [path, setPath] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [sessionType, setSessionType] = createSignal<SessionType>("");
  const [sharing, setSharing] = createSignal(false);
  const [steal, setSteal] = createSignal(true);
  const [encryption, setEncryption] = createSignal("");

  const [querying, setQuerying] = createSignal(false);
  const [queryError, setQueryError] = createSignal("");
  const [serverResult, setServerResult] = createSignal<ServerQueryResult | null>(null);

  let hostInputRef: HTMLInputElement | undefined;

  const handleConnect = () => {
    const opts: ConnectOptions = {
      host: host(),
      port: port(),
      ssl: ssl(),
      path: path() || undefined,
      username: username() || undefined,
      passwords: password() ? [password()] : undefined,
      startNewSession: sessionType() || null,
      sharing: sharing(),
      steal: steal(),
      encryptionKey: encryption() || undefined,
    };
    props.onConnect(opts);
  };

  const handleCancel = () => {
    setQueryError("");
    setServerResult(null);
    props.onCancel();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleQueryServer = async () => {
    setQuerying(true);
    setQueryError("");
    setServerResult(null);

    try {
      const api = new XpraServerAPI({
        host: host(),
        port: port(),
        ssl: ssl(),
        auth: username() && password()
          ? { username: username(), password: password() }
          : undefined,
      });

      const result = await api.fetchAll();
      setServerResult({
        info: result.info,
        sessions: result.sessions,
        displays: result.displays,
      });

      if (result.info?.mode && !sessionType()) {
        const mode = result.info.mode;
        if (mode === "seamless" || mode === "desktop" || mode === "shadow") {
          setSessionType(mode === "seamless" ? "" : mode === "desktop" ? "start-desktop" : "shadow");
        }
      }
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuerying(false);
    }
  };

  const sessionEntries = () => {
    const res = serverResult();
    if (!res?.sessions) return [];
    return Object.entries(res.sessions).map(([display, attrs]) => ({
      display,
      name: attrs["session-name"] ?? display,
      type: attrs["session-type"] ?? "",
    }));
  };

  const displayEntries = () => {
    const res = serverResult();
    if (!res?.displays) return [];
    return Object.entries(res.displays).map(([display, attrs]) => ({
      display,
      wmname: attrs.wmname ?? "",
    }));
  };

  return (
    <Show when={props.visible} fallback={null}>
      <div
        class="connect-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-header"
        onKeyDown={handleKeyDown}
      >
        <div class="connect-box" onClick={(e) => e.stopPropagation()}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConnect();
            }}
          >
            <div class="connect-innerbox">
              <span id="connect-header" class="connect-header">
                Server Connection
              </span>

              <div class="connect-form-grid">
                <label for="connect-host">Host</label>
                <input
                  id="connect-host"
                  ref={hostInputRef}
                  type="text"
                  value={host()}
                  onInput={(e) => setHost(e.currentTarget.value)}
                  placeholder="e.g. 192.168.1.1"
                  required
                />

                <label for="connect-port">Port</label>
                <input
                  id="connect-port"
                  type="number"
                  value={port()}
                  onInput={(e) => setPort(parseInt(e.currentTarget.value, 10) || 0)}
                  min={1}
                  max={65535}
                  required
                />

                <label for="connect-path">Path</label>
                <input
                  id="connect-path"
                  type="text"
                  value={path()}
                  onInput={(e) => setPath(e.currentTarget.value)}
                  placeholder="/"
                />

                <div class="connect-checkbox-row">
                  <label class="connect-checkbox-label">
                    <input
                      type="checkbox"
                      checked={ssl()}
                      onChange={(e) => setSsl(e.currentTarget.checked)}
                    />
                    SSL/TLS
                  </label>
                  <label class="connect-checkbox-label">
                    <input
                      type="checkbox"
                      checked={sharing()}
                      onChange={(e) => setSharing(e.currentTarget.checked)}
                    />
                    Sharing
                  </label>
                  <label class="connect-checkbox-label">
                    <input
                      type="checkbox"
                      checked={steal()}
                      onChange={(e) => setSteal(e.currentTarget.checked)}
                    />
                    Steal
                  </label>
                </div>

                <hr class="connect-divider" />

                <label for="connect-username">Username</label>
                <input
                  id="connect-username"
                  type="text"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                  placeholder="(optional)"
                  autocomplete="username"
                />

                <label for="connect-password">Password</label>
                <input
                  id="connect-password"
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder="(optional)"
                  autocomplete="current-password"
                />

                <label for="connect-encryption">Encryption Key</label>
                <input
                  id="connect-encryption"
                  type="password"
                  value={encryption()}
                  onInput={(e) => setEncryption(e.currentTarget.value)}
                  placeholder="(optional)"
                />

                <hr class="connect-divider" />

                <label for="connect-session-type">Session Type</label>
                <select
                  id="connect-session-type"
                  value={sessionType()}
                  onChange={(e) => setSessionType(e.currentTarget.value as SessionType)}
                >
                  <option value="">Attach (existing session)</option>
                  <option value="start">Start (Seamless)</option>
                  <option value="start-desktop">Start Desktop</option>
                  <option value="shadow">Shadow</option>
                </select>

                {/* Server query button */}
                <div class="connect-server-query">
                  <button
                    type="button"
                    class="connect-query-button"
                    disabled={querying() || !host()}
                    onClick={handleQueryServer}
                  >
                    {querying() ? "Querying…" : "Query Server"}
                  </button>
                </div>

                {/* Query error */}
                <Show when={queryError()}>
                  <div class="connect-error">{queryError()}</div>
                </Show>

                {/* Server info result */}
                <Show when={serverResult()}>
                  {(result) => (
                    <div class="connect-server-info">
                      <Show when={result().info}>
                        <div>
                          <strong>Server Mode:</strong>{" "}
                          {result().info!.mode || "(no active mode)"}
                        </div>
                      </Show>
                      <Show when={sessionEntries().length > 0}>
                        <div>
                          <strong>Sessions:</strong>
                          <For each={sessionEntries()}>
                            {(s) => (
                              <span> {s.name} ({s.display})</span>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={displayEntries().length > 0}>
                        <div>
                          <strong>Displays:</strong>
                          <For each={displayEntries()}>
                            {(d) => (
                              <span> {d.display}{d.wmname ? ` (${d.wmname})` : ""}</span>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={!result().info && sessionEntries().length === 0 && displayEntries().length === 0}>
                        <div>No information received from server.</div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>

              {/* Action buttons */}
              <div class="connect-buttons">
                <button
                  type="button"
                  class="connect-button connect-button-cancel"
                  onClick={handleCancel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="connect-button connect-button-connect"
                >
                  Connect
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
