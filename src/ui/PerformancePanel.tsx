/*
 * Author: Ali Parnan
 *
 * PerformancePanel — Side panel for tuning performance parameters.
 * Adjusts capabilities sent to the Xpra server and local decoder/renderer
 * behaviour at runtime.
 *
 * Primary UI: preset cards (Sharp / Balanced / Fast / Low Bandwidth).
 * Advanced mode: individual sliders revealed via toggle.
 */

import type { Component } from "solid-js";
import { Show, For, createSignal, createEffect, on, createMemo } from "solid-js";
import {
  performancePanelVisible,
  hidePerformancePanel,
  perfSettings,
  updatePerfSettings,
  sendPacket,
  PERF_DEFAULTS,
  PERF_PRESETS,
  matchPreset,
  type PerformanceSettings,
  type PresetId,
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
  const [selectedPreset, setSelectedPreset] = createSignal<PresetId | null>("balanced");
  const [showAdvanced, setShowAdvanced] = createSignal(false);

  createEffect(
    on(performancePanelVisible, (visible) => {
      if (visible) {
        const current = { ...perfSettings() };
        setLocal(current);
        setSelectedPreset(matchPreset(current));
      }
    }),
  );

  const isCustom = createMemo(() => selectedPreset() === null);

  const selectPreset = (id: PresetId) => {
    const preset = PERF_PRESETS.find((p) => p.id === id)!;
    setLocal({ ...preset.values });
    setSelectedPreset(id);
  };

  const set = <K extends keyof PerformanceSettings>(
    key: K,
    value: PerformanceSettings[K],
  ) => {
    setLocal((prev) => {
      const next = { ...prev, [key]: value };
      setSelectedPreset(matchPreset(next));
      return next;
    });
  };

  const handleApply = () => {
    const next = local();
    updatePerfSettings(next);

    sendPacket([PACKET_TYPES.quality, next.quality]);
    sendPacket([PACKET_TYPES.min_quality, next.minQuality]);
    sendPacket([PACKET_TYPES.speed, next.speed]);
    sendPacket([PACKET_TYPES.min_speed, next.minSpeed]);

    hidePerformancePanel();
  };

  const handleReset = () => {
    setLocal({ ...PERF_DEFAULTS });
    setSelectedPreset(matchPreset(PERF_DEFAULTS));
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
            {/* ---- Preset Cards ---- */}
            <div class="perf-section">
              <div class="perf-section-title">Choose a profile</div>
              <p class="perf-section-subtitle">
                Select a profile that matches your connection:
              </p>

              <div class="perf-preset-cards">
                <For each={PERF_PRESETS}>
                  {(preset) => (
                    <button
                      class={`perf-preset-card ${selectedPreset() === preset.id ? "perf-preset-card--active" : ""}`}
                      onClick={() => selectPreset(preset.id)}
                    >
                      <div class="perf-preset-card-radio">
                        <div class="perf-preset-card-radio-dot" />
                      </div>
                      <div class="perf-preset-card-content">
                        <div class="perf-preset-card-label">
                          {preset.label}
                          <span class="perf-preset-card-subtitle">
                            ({preset.subtitle})
                          </span>
                        </div>
                        <div class="perf-preset-card-desc">
                          {preset.description}
                        </div>
                      </div>
                    </button>
                  )}
                </For>
              </div>

              <Show when={isCustom()}>
                <div class="perf-custom-hint">
                  Custom — values don't match any preset
                </div>
              </Show>
            </div>

            {/* ---- Advanced Toggle ---- */}
            <button
              class="perf-advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <span
                class={`perf-advanced-chevron ${showAdvanced() ? "perf-advanced-chevron--open" : ""}`}
              >
                &#x25B6;
              </span>
              Advanced Settings
            </button>

            {/* ---- Advanced Sliders ---- */}
            <Show when={showAdvanced()}>
              <div class="perf-advanced-body">
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

                <div class="perf-section">
                  <div class="perf-section-title">Refresh</div>

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
                </div>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="perf-panel-footer">
            <button class="perf-btn perf-btn-reset" onClick={handleReset}>
              Reset
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

