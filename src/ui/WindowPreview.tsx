/*
 * Author: Ali Parnan
 *
 * Window preview — Carousel of window thumbnails.
 * Phase 6b-3.
 */

import type { Component } from "solid-js";
import { Show, For, createMemo } from "solid-js";
import {
  windowPreviewVisible,
  hideWindowPreview,
  getWindowsSortedByStacking,
  getWindowCanvas,
  raiseWindow,
  focusWindow,
} from "@/store";
import "./WindowPreview.css";

export const WindowPreview: Component = () => {
  const visible = () => windowPreviewVisible();

  const windows = createMemo(() => {
    const list = getWindowsSortedByStacking();
    return [...list].reverse();
  });

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      hideWindowPreview();
    }
  };

  const handleWindowClick = (wid: number) => {
    raiseWindow(wid);
    focusWindow(wid);
    hideWindowPreview();
  };

  return (
    <Show when={visible()} fallback={null}>
      <div
        class="window-preview-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Window preview"
        onClick={handleBackdropClick}
      >
        <div class="window-preview-container">
          <div class="window-preview-track">
            <For each={windows()}>
              {(win) => {
                const canvas = () => getWindowCanvas(win.wid);
                const dataUrl = () => {
                  const c = canvas();
                  if (!c || c.width === 0 || c.height === 0) return "";
                  try {
                    return c.toDataURL("image/png");
                  } catch {
                    return "";
                  }
                };
                return (
                  <div
                    class="window-preview-item"
                    onClick={() => handleWindowClick(win.wid)}
                  >
                    <div class="window-preview-item-img-wrap">
                      <Show when={dataUrl()} fallback={<span class="window-preview-placeholder">No preview</span>}>
                        <img
                          class="window-preview-item-img"
                          src={dataUrl()}
                          alt=""
                        />
                      </Show>
                    </div>
                    <div class="window-preview-item-text">
                      {win.title ?? `Window ${win.wid}`}
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};
