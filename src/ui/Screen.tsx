/*
 * Author: Ali Parnan
 *
 * Main screen container. Renders all Xpra windows in stacking order.
 * Uses native Pointer Events (no jQuery).
 */

import type { Component } from "solid-js";
import { For, createMemo } from "solid-js";
import { windows, focusedWid } from "@/store";
import { WindowFrame } from "./WindowFrame";
import { Taskbar } from "./Taskbar";
import "./Screen.css";

export const Screen: Component = () => {
  // Stable list of wids — only changes when windows are added/removed,
  // NOT when geometry, stacking, or focus changes. z-index handles
  // visual stacking via CSS.
  const wids = createMemo<number[]>((prev) => {
    const next = Object.keys(windows()).map(Number).sort((a, b) => a - b);
    if (prev && prev.length === next.length && prev.every((id, i) => id === next[i])) {
      return prev;
    }
    return next;
  });

  return (
    <div id="screen" class="screen" data-testid="screen">
      <div class="screen-branding">
        <img src="/icons/visulox-logo-128.png" alt="Visulox" class="screen-branding-logo" />
      </div>
      <For each={wids()}>
        {(wid) => (
          <WindowFrame
            wid={wid}
            focused={focusedWid() === wid}
          />
        )}
      </For>
      <Taskbar />
    </div>
  );
};
