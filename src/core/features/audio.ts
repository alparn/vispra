/*
 * Author: Ali Parnan
 *
 * Audio playback pipeline for Xpra HTML5 client.
 * Supports MediaSource API and Aurora.js (legacy) backends.
 * Ported from Client.js audio methods.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import {
  MediaSourceConstants,
  getMediaSource,
  getMediaSourceAudioCodecs,
  getAuroraAudioCodecs,
  getDefaultAudioCodec,
  getSupportedCodecs,
  getBestCodec,
  addMediaSourceEventDebugListeners,
  addMediaElementEventDebugListeners,
  addSourceBufferEventDebugListeners,
} from "@/core/codec/media-source";
import { u } from "@/core/utils/encoding";
import { isFirefox } from "@/core/utils/platform";
import type { ClientPacket } from "@/core/protocol/types";

const AUDIO_DEBUG = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AudioFramework = "mediasource" | "aurora" | "http-stream";
export type AudioState = "stopped" | "waiting" | "playing" | "error" | "disabled" | "";

interface AuroraSource {
  _on_data(data: Uint8Array): void;
}

interface AuroraAsset {
  source: AuroraSource;
  active: boolean;
  decoder: unknown;
}

interface AuroraPlayer {
  asset: AuroraAsset;
  play(): void;
  context?: AudioContext;
  playing: boolean;
  buffered: number;
  currentTime: number;
  duration: number;
  format?: { formatID: string; sampleRate: number };
  demuxer: unknown;
}

interface AuroraStatic {
  Decoder?: { find?: (codec: string) => unknown };
  Player: { fromXpraSource: () => AuroraPlayer };
}

export interface AudioManagerOptions {
  onSend: (packet: ClientPacket) => void;
  isConnected: () => boolean;
  onStateChange?: (state: AudioState, details: string) => void;
  debug?: (category: string, ...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_START_BUFFERS_DEFAULT = 4;
const MIN_START_BUFFERS_WITH_METADATA = 1;
const MAX_BUFFERS = 250;

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  private opts: AudioManagerOptions;

  private audioEnabled = false;
  private mediasourceEnabled = false;
  private auroraEnabled = false;

  private mediasourceCodecs: Record<string, string> = {};
  private auroraCodecs: Record<string, string> = {};
  private allCodecs: Record<string, string> = {};

  private framework: AudioFramework | null = null;
  private codec: string | null = null;

  private audioState: AudioState = "";

  // MediaSource state
  private mediaSource: MediaSource | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioSourceBuffer: SourceBuffer | null = null;
  private audioSourceReady = false;

  // Aurora state
  private auroraCtx: AuroraPlayer | null = null;

  // Bell (Web Audio API)
  private audioContext: AudioContext | null = null;

  // Buffer queue
  private buffers: Uint8Array[] = [];
  private buffersCount = 0;

  constructor(opts: AudioManagerOptions) {
    this.opts = opts;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Detect supported codecs and choose initial framework + codec.
   * Call this once before connecting.
   */
  init(ignoreBlacklist = false): void {
    this.mediasourceEnabled = typeof MediaSource !== "undefined";
    const win = globalThis as unknown as Record<string, unknown>;
    const AV = win.AV as AuroraStatic | undefined;
    this.auroraEnabled = Boolean(
      AV?.Decoder?.find && AV?.Player?.fromXpraSource,
    );

    this.d("init", "mediasource=", this.mediasourceEnabled, "aurora=", this.auroraEnabled);

    if (this.mediasourceEnabled) {
      this.mediasourceCodecs = getMediaSourceAudioCodecs(ignoreBlacklist);
      for (const [k, v] of Object.entries(this.mediasourceCodecs)) {
        this.allCodecs[k] = v;
      }
      this.d("MediaSource codecs:", Object.keys(this.mediasourceCodecs));
    }

    if (this.auroraEnabled) {
      this.auroraCodecs = getAuroraAudioCodecs();
      for (const [k, v] of Object.entries(this.auroraCodecs)) {
        if (!(k in this.allCodecs)) {
          this.allCodecs[k] = v;
        }
      }
      this.d("Aurora codecs:", Object.keys(this.auroraCodecs));
    }

    this.d("all codecs:", Object.keys(this.allCodecs));

    if (Object.keys(this.allCodecs).length === 0) {
      this.codec = null;
      this.audioEnabled = false;
      this.d("no valid audio codecs found");
      return;
    }

    this.codec = getDefaultAudioCodec(this.allCodecs);
    if (this.codec) {
      if (this.mediasourceEnabled && this.codec in this.mediasourceCodecs) {
        this.framework = "mediasource";
      } else if (this.auroraEnabled) {
        this.framework = "aurora";
      }

      if (this.framework) {
        this.audioEnabled = true;
        this.d("✓ enabled", "framework=", this.framework, "codec=", this.codec);
      } else {
        this.d("✗ no valid audio framework");
        this.audioEnabled = false;
      }
    } else {
      this.d("✗ no valid audio codec found");
      this.audioEnabled = false;
    }
  }

  /** Codec names for hello capabilities. */
  getCodecNames(): string[] {
    return Object.keys(this.allCodecs);
  }

  isEnabled(): boolean {
    return this.audioEnabled;
  }

  getFramework(): AudioFramework | null {
    return this.framework;
  }

  getCodec(): string | null {
    return this.codec;
  }

  getState(): AudioState {
    return this.audioState;
  }

  /**
   * Process server audio capabilities from the hello response.
   * Negotiates codec with server and starts receiving if possible.
   */
  processServerCaps(audioCaps: Record<string, unknown>): void {
    this.d("processServerCaps", "raw caps:", audioCaps);

    if (!this.audioEnabled) {
      this.d("processServerCaps: audio disabled locally, skipping");
      this.setAudioState("disabled", "");
      return;
    }

    if (!audioCaps["send"]) {
      this.audioEnabled = false;
      this.d("server does not support speaker forwarding (send=false)");
      this.setAudioState("disabled", "server does not support speaker forwarding");
      return;
    }

    const serverEncoders = audioCaps["encoders"] as string[] | undefined;
    if (!serverEncoders) {
      this.audioEnabled = false;
      this.d("server has no audio encoders");
      this.setAudioState("disabled", "audio codecs missing on the server");
      return;
    }

    this.d("server encoders:", serverEncoders);
    this.d("client codecs:", Object.keys(this.allCodecs));
    this.d("current codec:", this.codec, "framework:", this.framework);

    if (!this.codec || !serverEncoders.includes(this.codec)) {
      if (this.codec) {
        this.d("codec", this.codec, "not supported by server, negotiating...");
      }
      this.codec = null;

      for (const preferred of MediaSourceConstants.PREFERRED_CODEC_ORDER) {
        if (preferred in this.allCodecs && serverEncoders.includes(preferred)) {
          this.framework = (this.mediasourceCodecs[preferred])
            ? "mediasource"
            : "aurora";
          this.codec = preferred;
          this.d("✓ negotiated codec:", this.framework, this.codec);
          break;
        }
      }

      if (!this.codec) {
        this.audioEnabled = false;
        this.d("✗ no matching codec between client and server!");
        this.setAudioState("disabled", "no matching audio codec");
        return;
      }
    } else {
      this.d("✓ codec already matches server:", this.codec);
    }

    if (this.audioEnabled && !isFirefox()) {
      this.d("→ startReceiving()");
      this.startReceiving();
    } else if (isFirefox()) {
      this.d("Firefox detected, waiting for user gesture to start");
    }
  }

  /**
   * Called by the audio handler when a `sound-data` packet arrives.
   */
  private soundDataCount = 0;
  private soundDataBytes = 0;

  processSoundData(
    codec: string,
    buf: Uint8Array | null,
    options: Record<string, unknown>,
    metadata: Record<string, unknown> | null,
  ): void {
    this.soundDataCount++;
    const bufLen = buf?.length ?? 0;
    this.soundDataBytes += bufLen;

    if (this.soundDataCount <= 5 || this.soundDataCount % 50 === 0) {
      this.d("sound-data #", this.soundDataCount,
        "codec=", codec, "bytes=", bufLen,
        "total=", this.soundDataBytes, "B",
        "opts=", options,
        metadata ? "meta=yes" : "");
    }

    try {
      if (codec !== this.codec) {
        this.d("✗ codec mismatch! got=", codec, "expected=", this.codec);
        this.close();
        return;
      }

      if (options["start-of-stream"]) {
        this.d("▶ START-OF-STREAM");
        this.startStream();
      }

      if (buf && bufLen > 0) {
        this.addSoundData(codec, buf, metadata);
      }

      if (options["end-of-stream"]) {
        this.d("■ END-OF-STREAM", "total packets=", this.soundDataCount, "total bytes=", this.soundDataBytes);
        this.close();
      }
    } catch (err) {
      this.d("✗ sound data error:", err);
      this.setAudioState("error", String(err));
      this.close();
    }
  }

  /**
   * Play a bell tone using the Web Audio API.
   */
  playBell(percent: number, pitch: number, duration: number): void {
    if (!this.audioContext) {
      try {
        this.audioContext = new AudioContext();
      } catch {
        return;
      }
    }

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      gainNode.gain.setValueAtTime(
        Math.min(percent / 100, 1),
        this.audioContext.currentTime,
      );
      oscillator.frequency.setValueAtTime(pitch, this.audioContext.currentTime);
      oscillator.start();
      setTimeout(() => {
        try {
          oscillator.stop();
        } catch {
          // already stopped
        }
      }, duration);
    } catch (err) {
      this.d("bell error:", err);
    }
  }

  /**
   * Stop audio playback and clean up all resources.
   */
  close(): void {
    if (this.opts.isConnected() && this.audioEnabled) {
      this.sendSoundStop();
    }

    if (this.framework === "mediasource") {
      this.closeMediaSource();
    } else {
      this.closeAurora();
    }

    this.buffers = [];
    this.buffersCount = 0;
    this.setAudioState("stopped", "closed");
  }

  /**
   * Full cleanup including AudioContext. Call on disconnect.
   */
  destroy(): void {
    this.close();
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }
  }

  // -----------------------------------------------------------------------
  // Start receiving
  // -----------------------------------------------------------------------

  startReceiving(): void {
    if (!this.framework || !this.codec) {
      const supported = getSupportedCodecs(
        this.mediasourceEnabled,
        this.auroraEnabled,
        false,
      );
      const best = getBestCodec(supported);
      if (!best) {
        this.d("startReceiving: no codec found");
        return;
      }
      const parts = best.split(":");
      this.framework = parts[0] as AudioFramework;
      this.codec = parts[1];
    }

    this.d("startReceiving", "framework=", this.framework, "codec=", this.codec);

    try {
      this.buffers = [];
      this.buffersCount = 0;
      this.soundDataCount = 0;
      this.soundDataBytes = 0;
      if (this.framework === "mediasource") {
        this.startMediaSource();
      } else {
        this.startAurora();
      }
    } catch (err) {
      this.d("✗ error starting audio player:", err);
    }
  }

  // -----------------------------------------------------------------------
  // Aurora backend
  // -----------------------------------------------------------------------

  private startAurora(): void {
    const win = globalThis as unknown as Record<string, unknown>;
    const AV = win.AV as AuroraStatic | undefined;
    if (!AV?.Player?.fromXpraSource) {
      this.opts.error?.("Aurora.js not available");
      return;
    }
    this.auroraCtx = AV.Player.fromXpraSource();
    this.sendSoundStart();
  }

  private closeAurora(): void {
    if (this.auroraCtx) {
      if (this.auroraCtx.context) {
        try {
          this.auroraCtx.context.close();
        } catch (err) {
          this.d("error closing aurora context", err);
        }
      }
      this.auroraCtx = null;
    }
  }

  // -----------------------------------------------------------------------
  // MediaSource backend
  // -----------------------------------------------------------------------

  private startMediaSource(): void {
    this.mediaSource = getMediaSource();
    addMediaSourceEventDebugListeners(this.mediaSource, "audio");

    this.mediaSource.addEventListener("error", () => {
      this.audioError("audio source");
    });

    this.audioElement = document.createElement("audio");
    this.audioElement.setAttribute("autoplay", "true");
    addMediaElementEventDebugListeners(this.audioElement, "audio");

    this.audioElement.addEventListener("error", () => {
      this.audioError("audio");
    });
    document.body.append(this.audioElement);

    this.audioElement.src = URL.createObjectURL(this.mediaSource);
    this.buffers = [];
    this.buffersCount = 0;
    this.audioSourceReady = false;

    this.mediaSource.addEventListener("sourceopen", () => {
      this.opts.log?.("audio media source open");
      if (this.audioSourceReady) {
        this.opts.warn?.("ignoring: source already open");
        return;
      }

      const codecString = MediaSourceConstants.CODEC_STRING[this.codec!];
      if (!codecString) {
        this.opts.error?.(`invalid codec '${this.codec}'`);
        this.close();
        return;
      }
      this.opts.log?.(`using audio codec string for ${this.codec}: ${codecString}`);

      let asb: SourceBuffer;
      try {
        asb = this.mediaSource!.addSourceBuffer(codecString);
      } catch (err) {
        this.opts.error?.("audio setup error for", codecString, err);
        this.close();
        return;
      }

      this.audioSourceBuffer = asb;
      asb.mode = "sequence";
      addSourceBufferEventDebugListeners(asb, "audio");
      asb.addEventListener("error", () => this.audioError("audio buffer"));
      this.audioSourceReady = true;
      this.sendSoundStart();
    });
  }

  private closeMediaSource(): void {
    this.d("close_audio_mediasource");
    this.audioSourceReady = false;

    if (this.audioElement) {
      if (this.mediaSource) {
        try {
          if (this.audioSourceBuffer) {
            this.mediaSource.removeSourceBuffer(this.audioSourceBuffer);
            this.audioSourceBuffer = null;
          }
          if (this.mediaSource.readyState === "open") {
            this.mediaSource.endOfStream();
          }
        } catch (err) {
          this.opts.error?.("audio media source EOS error", err);
        }
        this.mediaSource = null;
      }
      this.removeAudioElement();
    }
  }

  private removeAudioElement(): void {
    if (this.audioElement) {
      this.audioElement.src = "";
      this.audioElement.load();
      try {
        this.audioElement.remove();
      } catch (err) {
        this.d("failed to remove audio from page:", err);
      }
      this.audioElement = null;
    }
  }

  private audioError(source: string): void {
    if (!this.mediaSource) {
      this.d(`media_source closed, ignoring audio error: ${source}`);
      return;
    }
    if (this.audioElement?.error) {
      const code = this.audioElement.error.code;
      this.opts.error?.(
        `${source} error:`,
        MediaSourceConstants.ERROR_CODE[code] ?? `code ${code}`,
      );
    } else {
      this.opts.error?.(`${source} error`);
    }
    this.close();
  }

  // -----------------------------------------------------------------------
  // Sound data buffering & push
  // -----------------------------------------------------------------------

  private addSoundData(
    codec: string,
    buf: Uint8Array,
    metadata: Record<string, unknown> | null,
  ): void {
    let minStartBuffers = MIN_START_BUFFERS_DEFAULT;

    this.d("sound-data:", codec, ",", buf.length, "bytes");

    if (this.buffers.length >= MAX_BUFFERS) {
      this.opts.warn?.(`audio queue overflowing: ${this.buffers.length}, stopping`);
      this.setAudioState("error", "queue overflow");
      this.close();
      return;
    }

    if (metadata) {
      this.d("audio metadata=", metadata);
      for (const key of Object.keys(metadata)) {
        const metadatum = metadata[key];
        this.buffers.push(u(metadatum));
      }
      minStartBuffers = MIN_START_BUFFERS_WITH_METADATA;
    }

    this.buffers.push(buf);

    if (
      this.isAudioReady() &&
      (this.buffersCount > 0 || this.buffers.length >= minStartBuffers)
    ) {
      const merged = this.concatBuffers();
      this.buffersCount += 1;
      this.pushAudioBuffer(merged);
      this.buffers = [];
    }
  }

  private concatBuffers(): Uint8Array {
    const ab = this.buffers;
    if (ab.length === 1) return ab[0];

    let totalSize = 0;
    for (const b of ab) totalSize += b.length;

    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const b of ab) {
      if (b.length > 0) {
        merged.set(b, offset);
        offset += b.length;
      }
    }
    return merged;
  }

  private isAudioReady(): boolean {
    if (this.framework === "mediasource") {
      const asb = this.audioSourceBuffer;
      return Boolean(asb && !asb.updating);
    }
    return Boolean(this.auroraCtx);
  }

  private pushAudioBuffer(buf: Uint8Array): void {
    if (this.framework === "mediasource") {
      this.audioSourceBuffer!.appendBuffer(buf as ArrayBufferView<ArrayBuffer>);
      const b = this.audioSourceBuffer!.buffered;
      if (b && b.length > 0 && this.audioElement) {
        const end = b.end(0);
        const bufSize = Math.round(1000 * (end - this.audioElement.currentTime));
        this.d("buffer size=", bufSize, "ms, currentTime=", this.audioElement.currentTime);
      }
    } else if (this.auroraCtx) {
      this.auroraCtx.asset.source._on_data(buf);
      this.d(
        "playing=", this.auroraCtx.playing,
        "buffered=", this.auroraCtx.buffered,
        "currentTime=", this.auroraCtx.currentTime,
      );
    }
    this.setAudioState("playing", "");
  }

  // -----------------------------------------------------------------------
  // Stream control
  // -----------------------------------------------------------------------

  private startStream(): void {
    this.d(`audio start of ${this.framework} ${this.codec} stream`);

    if (this.audioState === "playing" || this.audioState === "waiting") {
      return;
    }

    this.setAudioState("waiting", `${this.framework} playing ${this.codec} stream`);

    if (this.framework === "mediasource") {
      if (!this.audioElement) {
        this.setAudioState("error", "no audio element");
        this.close();
        return;
      }
      const playPromise = this.audioElement.play();
      if (!playPromise) {
        this.setAudioState("error", "no promise");
        this.close();
        return;
      }
      playPromise.then(
        () => {
          this.d("stream playing");
        },
        (err) => {
          this.setAudioState("error", `stream failed: ${err}`);
          this.close();
        },
      );
    } else if (this.framework === "http-stream") {
      this.opts.log?.("invalid start-of-stream data for http-stream framework");
    } else if (this.framework === "aurora") {
      this.auroraCtx?.play();
    } else {
      this.setAudioState("error", `unknown framework ${this.framework}`);
      this.close();
    }
  }

  // -----------------------------------------------------------------------
  // Protocol messages
  // -----------------------------------------------------------------------

  private sendSoundStart(): void {
    this.opts.log?.(`audio: requesting ${this.codec} stream from the server`);
    this.opts.onSend([PACKET_TYPES.sound_control, "start", this.codec!] as ClientPacket);
  }

  private sendSoundStop(): void {
    this.opts.log?.("audio: stopping stream");
    this.opts.onSend([PACKET_TYPES.sound_control, "stop"] as ClientPacket);
  }

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  private setAudioState(state: AudioState, details: string): void {
    this.audioState = state;
    this.opts.onStateChange?.(state, details);
  }

  // -----------------------------------------------------------------------
  // Logging shorthand
  // -----------------------------------------------------------------------

  private d(...args: unknown[]): void {
    if (!AUDIO_DEBUG) return;
    console.log("%c[AUDIO]", "color:#1db954;font-weight:bold", ...args);
  }
}
