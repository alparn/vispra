/*
 * Author: Ali Parnan
 *
 * Taskbar — bottom bar showing all open windows as clickable buttons.
 * Minimized windows can be restored by clicking their taskbar entry.
 */

import type { Component } from "solid-js";
import { For, Show, createMemo } from "solid-js";
import {
  windows,
  focusedWid,
  focusWindow,
  raiseWindow,
  minimizeWindow,
  restoreWindow,
  updateWindowGeometry,
  sendPacket,
  togglePerformancePanel,
  performancePanelVisible,
} from "@/store";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import type { ConfigureWindowPacket, BufferRefreshPacket } from "@/core/protocol/types";
import { resizeRenderer } from "@/store/client-bridge";
import type { WindowState } from "@/store";
import "./Taskbar.css";

function taskbarLabel(w: WindowState): string {
  if (w.title) {
    return w.title.length > 32 ? w.title.slice(0, 30) + "\u2026" : w.title;
  }
  const ci = w.classInstance;
  if (ci && ci.length >= 2) return ci[0];
  return `Window ${w.wid}`;
}

export const Taskbar: Component = () => {
  const hasDesktopWindow = createMemo(() =>
    Object.values(windows()).some((w) => w.isDesktop),
  );

  const entries = createMemo(() => {
    const all = windows();
    return Object.values(all)
      .filter((w) => !w.overrideRedirect && !w.tray && !w.isDesktop)
      .sort((a, b) => a.wid - b.wid);
  });

  const fitToScreen = () => {
    const wid = focusedWid();
    if (!wid) return;
    const w = windows()[wid];
    if (!w || w.isDesktop) return;

    const TASKBAR_H = 40;
    const PADDING = 40;
    const maxW = window.innerWidth - PADDING * 2;
    const maxH = window.innerHeight - TASKBAR_H - PADDING * 2;

    const newW = Math.min(w.width, maxW);
    const newH = Math.min(w.height, maxH);
    const newX = Math.round((window.innerWidth - newW) / 2);
    const newY = Math.round((window.innerHeight - TASKBAR_H - newH) / 2);

    updateWindowGeometry(wid, newX, newY, newW, newH);
    resizeRenderer(wid, newW, newH);
    sendPacket([PACKET_TYPES.configure_window, wid, newX, newY, newW, newH, {}, 0, {}, false] as ConfigureWindowPacket);
    sendPacket([PACKET_TYPES.buffer_refresh, wid, 0, 100, { "refresh-now": true, batch: { reset: true } }, {}] as BufferRefreshPacket);
  };

  const handleClick = (wid: number) => {
    const all = windows();
    const w = all[wid];
    if (!w) return;

    if (w.minimized) {
      restoreWindow(wid);
      raiseWindow(wid);
      focusWindow(wid);
    } else if (focusedWid() === wid) {
      minimizeWindow(wid);
    } else {
      raiseWindow(wid);
      focusWindow(wid);
    }
  };

  return (
    <Show when={!hasDesktopWindow()}>
      <div class="taskbar">
        <div class="taskbar-windows">
          <For each={entries()}>
            {(w) => (
              <button
                class={`taskbar-entry${focusedWid() === w.wid ? " active" : ""}${w.minimized ? " minimized" : ""}`}
                onClick={() => handleClick(w.wid)}
                title={w.title ?? `Window ${w.wid}`}
              >
                <span class="taskbar-entry-icon" />
                <span class="taskbar-entry-label">{taskbarLabel(w)}</span>
              </button>
            )}
          </For>
        </div>

        <div class="taskbar-tray">
          <Show when={focusedWid() > 0}>
            <button
              class="taskbar-tray-btn"
              onClick={fitToScreen}
              title="Fit window to screen"
              aria-label="Fit window to screen"
            >
              <svg
                class="taskbar-tray-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" />
                <path d="M3 21l7-7" />
              </svg>
            </button>
          </Show>
          <button
            class={`taskbar-tray-btn${performancePanelVisible() ? " active" : ""}`}
            onClick={() => togglePerformancePanel()}
            title="Performance Tuning"
            aria-label="Toggle Performance Panel"
          >
            <svg
              class="taskbar-tray-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 20a8 8 0 1 1 8-8" />
              <path d="M12 12l3.5-3.5" />
              <circle cx="12" cy="12" r="1.5" />
              <path d="M4.9 15.5L3.5 17" />
              <path d="M19.1 15.5L20.5 17" />
            </svg>
          </button>
        </div>
      </div>
    </Show>
  );
};
