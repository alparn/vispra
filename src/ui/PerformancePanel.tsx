/*
 * Author: Ali Parnan
 *
 * PerformancePanel — Side panel for tuning performance parameters.
 * Adjusts capabilities sent to the Xpra server and local decoder/renderer
 * behaviour at runtime.
 */

import type { Component } from "solid-js";
import { Show, createSignal, createEffect, on } from "solid-js";
import {
  performancePanelVisible,
  hidePerformancePanel,
  perfSettings,
  updatePerfSettings,
  sendPacket,
  PERF_DEFAULTS,
  type PerformanceSettings,
} from "@/store";
import { PACKET_TYPES } from "@/core/constants/packet-types";
import "./PerformancePanel.css";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PerformancePanel: Component = () => {
  const [local, setLocal] = createSignal<PerformanceSettings>({
    ...PERF_DEFAULTS,
  });

  createEffect(
    on(performancePanelVisible, (visible) => {
      if (visible) {
        setLocal({ ...perfSettings() });
      }
    }),
  );

  const set = <K extends keyof PerformanceSettings>(
    key: K,
    value: PerformanceSettings[K],
  ) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const handleApply = () => {
    const next = local();
    updatePerfSettings(next);

    const settingChanges: [string, unknown][] = [
      ["quality", next.quality],
      ["min-quality", next.minQuality],
      ["speed", next.speed],
      ["min-speed", next.minSpeed],
      ["auto_refresh_delay", next.autoRefreshDelay],
    ];
    for (const [name, value] of settingChanges) {
      sendPacket([PACKET_TYPES.setting_change, name, value]);
    }

    hidePerformancePanel();
  };

  const handleReset = () => {
    setLocal({ ...PERF_DEFAULTS });
  };

  const handleBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) hidePerformancePanel();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") hidePerformancePanel();
  };

  return (
    <Show when={performancePanelVisible()}>
      <div
        class="perf-panel-backdrop"
        onClick={handleBackdrop}
        onKeyDown={handleKeyDown}
      >
        <div class="perf-panel" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div class="perf-panel-header">
            <span class="perf-panel-title">Performance Tuning</span>
            <button
              class="perf-panel-close"
              onClick={() => hidePerformancePanel()}
              title="Close"
            >
              &#x2715;
            </button>
          </div>

          {/* Body */}
          <div class="perf-panel-body">
            {/* ---- Encoding Quality / Speed ---- */}
            <div class="perf-section">
              <div class="perf-section-title">Encoding</div>

              <Slider
                label="Quality"
                hint="Higher = sharper image, more bandwidth"
                value={local().quality}
                min={10}
                max={100}
                onChange={(v) => set("quality", v)}
              />
              <Slider
                label="Min Quality"
                hint="Floor quality during high motion"
                value={local().minQuality}
                min={1}
                max={100}
                onChange={(v) => set("minQuality", v)}
              />
              <Slider
                label="Speed"
                hint="Higher = faster encode, less compression"
                value={local().speed}
                min={10}
                max={100}
                onChange={(v) => set("speed", v)}
              />
              <Slider
                label="Min Speed"
                hint="Floor speed under heavy load"
                value={local().minSpeed}
                min={1}
                max={100}
                onChange={(v) => set("minSpeed", v)}
              />
            </div>

            {/* ---- Video ---- */}
            <div class="perf-section">
              <div class="perf-section-title">Video</div>

              <Slider
                label="Max Video Width"
                hint="Limits video codec resolution"
                value={local().videoMaxWidth}
                min={640}
                max={7680}
                step={64}
                suffix="px"
                onChange={(v) => set("videoMaxWidth", v)}
              />
              <Slider
                label="Max Video Height"
                hint="Limits video codec resolution"
                value={local().videoMaxHeight}
                min={480}
                max={4320}
                step={64}
                suffix="px"
                onChange={(v) => set("videoMaxHeight", v)}
              />

              <div class="perf-toggle-row">
                <span class="perf-toggle-label">Video Scaling</span>
                <label class="perf-toggle">
                  <input
                    type="checkbox"
                    checked={local().videoScaling}
                    onChange={(e) =>
                      set("videoScaling", e.currentTarget.checked)
                    }
                  />
                  <span class="perf-toggle-track">
                    <span class="perf-toggle-knob" />
                  </span>
                </label>
              </div>
            </div>

            {/* ---- Refresh & Rendering ---- */}
            <div class="perf-section">
              <div class="perf-section-title">Refresh &amp; Rendering</div>

              <Slider
                label="Auto-Refresh Delay"
                hint="Lossless re-send delay after region becomes static"
                value={local().autoRefreshDelay}
                min={50}
                max={1000}
                step={10}
                suffix="ms"
                onChange={(v) => set("autoRefreshDelay", v)}
              />
              <Slider
                label="Frame Threshold"
                hint="Max queued frames before decoder throttles"
                value={local().frameThreshold}
                min={10}
                max={1000}
                step={10}
                onChange={(v) => set("frameThreshold", v)}
              />
              <Slider
                label="Paint Timeout"
                hint="Max wait before forcing next paint"
                value={local().paintTimeout}
                min={200}
                max={5000}
                step={100}
                suffix="ms"
                onChange={(v) => set("paintTimeout", v)}
              />

              <div class="perf-row">
                <div class="perf-row-header">
                  <span class="perf-row-label">Resize Quality</span>
                </div>
                <select
                  class="perf-select"
                  value={local().resizeQuality}
                  onChange={(e) =>
                    set(
                      "resizeQuality",
                      e.currentTarget.value as "low" | "medium" | "high",
                    )
                  }
                >
                  <option value="low">Low (fastest)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (sharpest)</option>
                </select>
              </div>
            </div>

            {/* ---- Network ---- */}
            <div class="perf-section">
              <div class="perf-section-title">Network</div>

              <Slider
                label="Compression Level"
                hint="Higher = smaller packets, more CPU"
                value={local().compressionLevel}
                min={0}
                max={9}
                onChange={(v) => set("compressionLevel", v)}
              />
              <Slider
                label="Bandwidth Limit"
                hint="0 = unlimited"
                value={local().bandwidthLimit}
                min={0}
                max={100_000_000}
                step={500_000}
                suffix=" B/s"
                format={formatBandwidth}
                onChange={(v) => set("bandwidthLimit", v)}
              />
            </div>
          </div>

          {/* Footer */}
          <div class="perf-panel-footer">
            <button class="perf-btn perf-btn-reset" onClick={handleReset}>
              Reset Defaults
            </button>
            <button class="perf-btn perf-btn-apply" onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

// ---------------------------------------------------------------------------
// Slider sub-component
// ---------------------------------------------------------------------------

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

const Slider: Component<SliderProps> = (props) => {
  const display = () =>
    props.format
      ? props.format(props.value)
      : `${props.value}${props.suffix ?? ""}`;

  return (
    <div class="perf-row">
      <div class="perf-row-header">
        <span class="perf-row-label">{props.label}</span>
        <span class="perf-row-value">{display()}</span>
      </div>
      <input
        type="range"
        class="perf-slider"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      {props.hint && <div class="perf-row-hint">{props.hint}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBandwidth(bytes: number): string {
  if (bytes === 0) return "Unlimited";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB/s`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB/s`;
  return `${bytes} B/s`;
}
