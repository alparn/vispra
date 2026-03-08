/*
 * Author: Ali Parnan
 */

/**
 * Audio store — Audio playback state.
 * Manages audio enablement, codecs, and framework selection.
 * Ported from Client.js audio-related init_state.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AudioFramework = "mediasource" | "aurora" | "http-stream" | null;

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const [audioEnabled, setAudioEnabled] = createSignal(false);
const [audioState, setAudioState] = createSignal("");
const [audioCodecs, setAudioCodecs] = createSignal<Record<string, unknown>>({});
const [audioFramework, setAudioFramework] = createSignal<AudioFramework>(null);
const [audioCodec, setAudioCodec] = createSignal<string | null>(null);
const [mediasourceEnabled, setMediasourceEnabled] = createSignal(false);
const [auroraEnabled, setAuroraEnabled] = createSignal(false);
const [httpStreamEnabled, setHttpStreamEnabled] = createSignal(false);

// ---------------------------------------------------------------------------
// Getters (reactive)
// ---------------------------------------------------------------------------

export function getAudioEnabled(): boolean {
  return audioEnabled();
}

export function getAudioState(): string {
  return audioState();
}

export function getAudioCodecs(): Record<string, unknown> {
  return audioCodecs();
}

export function getAudioFramework(): AudioFramework {
  return audioFramework();
}

export function getAudioCodec(): string | null {
  return audioCodec();
}

export function isMediasourceEnabled(): boolean {
  return mediasourceEnabled();
}

export function isAuroraEnabled(): boolean {
  return auroraEnabled();
}

export function isHttpStreamEnabled(): boolean {
  return httpStreamEnabled();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function enableAudio(enabled: boolean): void {
  setAudioEnabled(enabled);
}

export function setAudioPlaybackState(state: string): void {
  setAudioState(state);
}

export function setAudioCodecList(codecs: Record<string, unknown>): void {
  setAudioCodecs(codecs);
}

export function setActiveAudioFramework(framework: AudioFramework): void {
  setAudioFramework(framework);
}

export function setActiveAudioCodec(codec: string | null): void {
  setAudioCodec(codec);
}

export function setAudioBackendFlags(flags: {
  mediasource?: boolean;
  aurora?: boolean;
  httpStream?: boolean;
}): void {
  if (flags.mediasource !== undefined) setMediasourceEnabled(flags.mediasource);
  if (flags.aurora !== undefined) setAuroraEnabled(flags.aurora);
  if (flags.httpStream !== undefined) setHttpStreamEnabled(flags.httpStream);
}

export function resetAudio(): void {
  setAudioEnabled(false);
  setAudioState("");
  setAudioCodecs({});
  setAudioFramework(null);
  setAudioCodec(null);
}

// ---------------------------------------------------------------------------
// Store object
// ---------------------------------------------------------------------------

export const audioStore = {
  audioEnabled,
  audioState,
  audioCodecs,
  audioFramework,
  audioCodec,
  mediasourceEnabled,
  auroraEnabled,
  httpStreamEnabled,

  getAudioEnabled,
  getAudioState,
  getAudioCodecs,
  getAudioFramework,
  getAudioCodec,
  isMediasourceEnabled,
  isAuroraEnabled,
  isHttpStreamEnabled,

  enableAudio,
  setAudioPlaybackState,
  setAudioCodecList,
  setActiveAudioFramework,
  setActiveAudioCodec,
  setAudioBackendFlags,
  resetAudio,
};
