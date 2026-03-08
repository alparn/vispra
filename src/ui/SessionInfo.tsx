/*
 * Author: Ali Parnan
 *
 * Session info overlay — Connection data from info-response packets.
 * Phase 6b-3.
 */

import type { Component } from "solid-js";
import { Show } from "solid-js";
import {
  sessionInfoVisible,
  hideSessionInfo,
  connectionStore,
  sessionInfoStore,
} from "@/store";
import "./SessionInfo.css";

export const SessionInfo: Component = () => {
  const visible = () => sessionInfoVisible();
  const serverInfo = () => connectionStore.serverInfo;
  const sessionData = () => sessionInfoStore.data;

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      hideSessionInfo();
    }
  };

  return (
    <Show when={visible()} fallback={null}>
      <div
        class="session-info-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-info-title"
        onClick={handleBackdropClick}
      >
        <div class="session-info-box" onClick={(e) => e.stopPropagation()}>
          <h2 id="session-info-title">Session Information</h2>
          <h3>Connection Data</h3>
          <table class="session-data">
            <caption>Session Connection Data Information</caption>
            <tbody>
              <tr>
                <th scope="row">Server Display</th>
                <td>{serverInfo().display || "—"}</td>
              </tr>
              <tr>
                <th scope="row">Server Platform</th>
                <td>{serverInfo().platform || "—"}</td>
              </tr>
              <tr>
                <th scope="row">Server Load</th>
                <td>
                  {(() => {
                    const load = sessionData().serverLoad;
                    return Array.isArray(load) ? load.join(", ") : (load ?? "—");
                  })()}
                </td>
              </tr>
              <tr>
                <th scope="row">Session Connected</th>
                <td>{String(sessionData().sessionConnected ?? "—")}</td>
              </tr>
              <tr>
                <th scope="row">Server Latency</th>
                <td>
                  {sessionData().serverLatency != null
                    ? `${sessionData().serverLatency} ms`
                    : "—"}
                </td>
              </tr>
              <tr>
                <th scope="row">Client Latency</th>
                <td>
                  {sessionData().clientLatency != null
                    ? `${sessionData().clientLatency} ms`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <button
            type="button"
            class="session-info-close"
            onClick={() => hideSessionInfo()}
          >
            Close
          </button>
        </div>
      </div>
    </Show>
  );
};
