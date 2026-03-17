/*
 * Author: Ali Parnan
 *
 * Taskbar — bottom bar showing all open windows as clickable buttons.
 * In desktop mode the full taskbar is replaced by a compact floating
 * toolbar (top-center) that only shows tray actions.
 */

import type { Component } from "solid-js";
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js";
import {
  windows,
  focusedWid,
  focusWindow,
  raiseWindow,
  minimizeWindow,
  restoreWindow,
  sendCloseWindow,
  updateWindowGeometry,
  sendPacket,
  togglePerformancePanel,
  performancePanelVisible,
  toggleVirtualKeyboard,
  virtualKeyboardVisible,
} from "@/store";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import type { ConfigureWindowPacket, BufferRefreshPacket } from "@/core/protocol/types";
import { resizeRenderer, triggerConfigureDisplay } from "@/store/client-bridge";
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

// ---------------------------------------------------------------------------
// Tray buttons — shared between both modes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Open Windows dropdown — legacy-style window list for restore/minimize/close
// ---------------------------------------------------------------------------

const OpenWindowsDropdown: Component<{
  entries: () => WindowState[];
  onRestore: (wid: number) => void;
  onMinimize: (wid: number) => void;
  onMaximize: (wid: number) => void;
  onClose: (wid: number) => void;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  let containerEl: HTMLDivElement | undefined;

  const toggle = () => setOpen((o) => !o);
  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (containerEl && !containerEl.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    onCleanup(() => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    });
  });
  const close = () => setOpen(false);

  const handleRowClick = (wid: number) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".open-windows-row-actions")) return;
    const w = windows()[wid];
    if (w?.minimized) {
      props.onRestore(wid);
    } else {
      raiseWindow(wid);
      focusWindow(wid);
    }
    close();
  };

  return (
    <div ref={(el) => { containerEl = el; }} class="open-windows-wrapper">
      <button
        class="taskbar-tray-btn"
        onClick={toggle}
        title="Open Windows"
        aria-label="Open Windows"
        aria-expanded={open()}
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
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      </button>
      <Show when={open()}>
        <div
          class="open-windows-dropdown"
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <For each={props.entries()}>
            {(w) => (
              <div
                class={`open-windows-row${focusedWid() === w.wid ? " active" : ""}${w.minimized ? " minimized" : ""}`}
                role="menuitem"
                onClick={handleRowClick(w.wid)}
              >
                <div class="open-windows-row-main">
                  {w.iconDataUrl
                    ? <img class="open-windows-icon" src={w.iconDataUrl} alt="" />
                    : <span class="open-windows-icon open-windows-icon--default" />}
                  <span class="open-windows-title">{taskbarLabel(w)}</span>
                </div>
                <div class="open-windows-row-actions">
                  <button
                    type="button"
                    class="open-windows-action"
                    title="Minimize"
                    onClick={(e) => { e.stopPropagation(); props.onMinimize(w.wid); }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="open-windows-action"
                    title="Maximize"
                    onClick={(e) => { e.stopPropagation(); props.onMaximize(w.wid); }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="open-windows-action"
                    title="Close"
                    onClick={(e) => { e.stopPropagation(); props.onClose(w.wid); close(); }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tray buttons — shared between both modes
// ---------------------------------------------------------------------------

const TrayButtons: Component<{
  fitToScreen?: () => void;
  centerDesktop?: () => void;
  toggleFullscreen?: () => void;
  showFit?: boolean;
  desktop?: boolean;
  openWindowsEntries?: () => WindowState[];
  onMaximizeWindow?: (wid: number) => void;
}> = (props) => (
  <>
    {/* Open Windows — desktop mode only (legacy-style) */}
    <Show when={props.desktop && props.openWindowsEntries}>
      <OpenWindowsDropdown
        entries={props.openWindowsEntries!}
        onRestore={(wid) => {
          restoreWindow(wid);
          raiseWindow(wid);
          focusWindow(wid);
        }}
        onMinimize={minimizeWindow}
        onMaximize={props.onMaximizeWindow ?? (() => {})}
        onClose={sendCloseWindow}
      />
    </Show>
    {/* Fullscreen toggle — always visible */}
    <button
      class="taskbar-tray-btn"
      onClick={() => props.toggleFullscreen?.()}
      title="Fullscreen"
      aria-label="Toggle Fullscreen"
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
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </svg>
    </button>
    {/* Virtual keyboard toggle — always visible */}
    <button
      class={`taskbar-tray-btn${virtualKeyboardVisible() ? " active" : ""}`}
      onClick={() => toggleVirtualKeyboard()}
      title="Virtual Keyboard"
      aria-label="Toggle Virtual Keyboard"
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
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M6 8h.01" />
        <path d="M10 8h.01" />
        <path d="M14 8h.01" />
        <path d="M18 8h.01" />
        <path d="M6 12h.01" />
        <path d="M10 12h.01" />
        <path d="M14 12h.01" />
        <path d="M18 12h.01" />
        <path d="M8 16h8" />
      </svg>
    </button>
    {/* Center desktop — desktop mode only */}
    <Show when={props.desktop}>
      <button
        class="taskbar-tray-btn"
        onClick={() => props.centerDesktop?.()}
        title="Fit desktop to browser"
        aria-label="Fit desktop to browser window"
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
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
        </svg>
      </button>
    </Show>
    {/* Center window — seamless only */}
    <Show when={props.showFit}>
      <button
        class="taskbar-tray-btn"
        onClick={() => props.fitToScreen?.()}
        title="Center window"
        aria-label="Center window on screen"
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
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
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
  </>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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

  // All windows for Open Windows dropdown (desktop mode) — includes desktop window
  const openWindowsEntries = createMemo(() => {
    const all = windows();
    return Object.values(all)
      .filter((w) => !w.overrideRedirect && !w.tray)
      .sort((a, b) => a.wid - b.wid);
  });

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  const centerDesktop = () => {
    const desktopWin = Object.values(windows()).find((w) => w.isDesktop);
    if (!desktopWin) return;

    const wid = desktopWin.wid;
    const w = window.innerWidth;
    const h = window.innerHeight;

    console.log("[center-desktop] step 1: configure_display to %dx%d", w, h);
    triggerConfigureDisplay();

    console.log("[center-desktop] step 2: update local geometry wid=%d to %dx%d", wid, w, h);
    updateWindowGeometry(wid, 0, 0, w, h);
    resizeRenderer(wid, w, h);
    sendPacket([PACKET_TYPES.configure_window, wid, 0, 0, w, h, {}, 0, {}, false] as ConfigureWindowPacket);

    console.log("[center-desktop] step 3: send Alt+F10 (WM Maximize) via key-action");
    const sendKey = (keyname: string, pressed: boolean, mods: string[], keyval: number, keycode: number) => {
      sendPacket([PACKET_TYPES.key_action, wid, keyname, pressed, mods, keyval, "", keycode, 0] as unknown as ConfigureWindowPacket);
    };
    setTimeout(() => {
      sendKey("Alt_L", true, [], 65513, 64);
      sendKey("F10", true, ["mod1"], 65479, 76);
      sendKey("F10", false, ["mod1"], 65479, 76);
      sendKey("Alt_L", false, [], 65513, 64);
      console.log("[center-desktop] step 4: Alt+F10 sent");
    }, 300);

    setTimeout(() => {
      console.log("[center-desktop] step 5: buffer_refresh");
      sendPacket([PACKET_TYPES.buffer_refresh, wid, 0, 100, { "refresh-now": true, batch: { reset: true } }, {}] as BufferRefreshPacket);
    }, 600);
  };

  const maximizeWindow = (wid: number) => {
    const w = windows()[wid];
    if (!w) return;
    const fullW = window.innerWidth;
    const fullH = window.innerHeight;
    if (w.isDesktop) {
      const desktopWin = Object.values(windows()).find((x) => x.isDesktop);
      if (desktopWin?.wid === wid) centerDesktop();
    } else {
      updateWindowGeometry(wid, 0, 0, fullW, fullH);
      resizeRenderer(wid, fullW, fullH);
      sendPacket([PACKET_TYPES.configure_window, wid, 0, 0, fullW, fullH, {}, 0, {}, false] as ConfigureWindowPacket);
      sendPacket([PACKET_TYPES.buffer_refresh, wid, 0, 100, { "refresh-now": true, batch: { reset: true } }, {}] as BufferRefreshPacket);
    }
  };

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
    <>
      {/* Desktop mode: compact floating toolbar at top center */}
      <Show when={hasDesktopWindow()}>
        <div class="floating-toolbar">
          <TrayButtons
            toggleFullscreen={toggleFullscreen}
            centerDesktop={centerDesktop}
            desktop={true}
            openWindowsEntries={openWindowsEntries}
            onMaximizeWindow={maximizeWindow}
          />
        </div>
      </Show>

      {/* Seamless mode: full taskbar at bottom */}
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
                  {w.iconDataUrl
                    ? <img class="taskbar-entry-icon" src={w.iconDataUrl} alt="" />
                    : <span class="taskbar-entry-icon taskbar-entry-icon--default" />
                  }
                  <span class="taskbar-entry-label">{taskbarLabel(w)}</span>
                </button>
              )}
            </For>
          </div>

          <div class="taskbar-tray">
            <TrayButtons
              toggleFullscreen={toggleFullscreen}
              fitToScreen={fitToScreen}
              showFit={focusedWid() > 0}
            />
          </div>
        </div>
      </Show>
    </>
  );
};
