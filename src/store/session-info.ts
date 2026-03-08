/*
 * Author: Ali Parnan
 *
 * Session info store — Data from info-response packets for SessionInfo overlay.
 * Phase 6b-3: SessionInfo component.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionInfoData {
  serverLoad?: number[];
  serverLatency?: number;
  clientLatency?: number;
  sessionConnected?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const [sessionInfoData, setSessionInfoData] = createSignal<SessionInfoData>({});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function updateSessionInfo(data: Record<string, unknown>): void {
  setSessionInfoData((prev) => ({ ...prev, ...data }));
}

export function clearSessionInfo(): void {
  setSessionInfoData({});
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const sessionInfoStore = {
  get data() {
    return sessionInfoData();
  },
  updateSessionInfo,
  clearSessionInfo,
};
