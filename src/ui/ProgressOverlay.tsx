/*
 * Author: Ali Parnan
 *
 * Progress overlay — Connection progress during handshake.
 * Phase 6b-3.
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
      <p class="progress-label">{p().state || " "}</p>
      <p class="progress-details">{p().details || " "}</p>
      <progress
        class="progress-bar"
        max={100}
        value={p().progress}
        aria-valuenow={p().progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
    </Show>
  );
};
