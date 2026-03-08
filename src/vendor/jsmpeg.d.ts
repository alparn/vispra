interface JSMpegPlayer {
  destroy(): void;
  play(): void;
  pause(): void;
  stop(): void;
  write(buffer: Uint8Array): void;
}

interface JSMpegPlayerOptions {
  source?: string;
  canvas?: HTMLCanvasElement;
  loop?: boolean;
  autoplay?: boolean;
  audio?: boolean;
  video?: boolean;
  poster?: string;
  pauseWhenHidden?: boolean;
  disableGl?: boolean;
  disableWebAssembly?: boolean;
  preserveDrawingBuffer?: boolean;
  progressive?: boolean;
  throttled?: boolean;
  chunkSize?: number;
  decodeFirstFrame?: boolean;
  maxAudioLag?: number;
  videoBufferSize?: number;
  audioBufferSize?: number;
  onVideoDecode?(decoder: unknown, time: number): void;
  onAudioDecode?(decoder: unknown, time: number): void;
  onPlay?(player: JSMpegPlayer): void;
  onPause?(player: JSMpegPlayer): void;
  onEnded?(player: JSMpegPlayer): void;
  onStalled?(player: JSMpegPlayer): void;
  onSourceEstablished?(source: unknown): void;
  onSourceCompleted?(source: unknown): void;
}

interface JSMpegStatic {
  Player: new (url: string | null, options?: JSMpegPlayerOptions) => JSMpegPlayer;
  VideoElement: unknown;
  BitBuffer: unknown;
  Now(): number;
  CreateVideoElements(): void;
}

declare const JSMpeg: JSMpegStatic;
