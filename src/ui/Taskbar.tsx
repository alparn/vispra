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
} from "@/store";
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
    </Show>
  );
};
