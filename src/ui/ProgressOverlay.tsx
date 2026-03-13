/*
 * Author: Ali Parnan
 *
 * Progress overlay — Modern glassmorphic loading screen.
 * Shows real connection progress from the xpra server with animated blobs,
 * gradient progress bar, and spinner ring.
 */

import type { Component } from "solid-js";
import { Show } from "solid-js";
import { progress } from "@/store";
import "./ProgressOverlay.css";

export const ProgressOverlay: Component = () => {
  const p = () => progress();

  return (
    <Show when={p().progress < 100} fallback={null}>
      <div class="progress-overlay" role="status" aria-live="polite">
        {/* Background blobs */}
        <div class="progress-blob progress-blob--1" />
        <div class="progress-blob progress-blob--2" />
        <div class="progress-blob progress-blob--3" />
        <div class="progress-blob progress-blob--4" />

        {/* Subtle grid */}
        <div class="progress-grid" />

        {/* Glass card */}
        <div class="progress-card">
          {/* Spinner ring */}
          <div class="progress-spinner">
            <div class="progress-spinner__track" />
            <div class="progress-spinner__ring" />
          </div>

          {/* Server state label */}
          <div class="progress-text-container">
            <p class="progress-label">
              {p().state || "Connecting"}
            </p>
          </div>

          {/* Connection details (URI etc.) */}
          <Show when={p().details}>
            <p class="progress-details">{p().details}</p>
          </Show>

          {/* Animated progress bar */}
          <div class="progress-bar-wrapper">
            <div
              class="progress-bar-fill"
              style={{ width: `${p().progress}%` }}
            />
            <div
              class="progress-bar-glow"
              style={{ left: `calc(${Math.max(0, p().progress)}% - 16px)` }}
            />
          </div>

          {/* Percentage */}
          <span class="progress-percentage">
            {Math.round(p().progress)}%
          </span>
        </div>
      </div>
    </Show>
  );
};
