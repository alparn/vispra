interface AVBuffer {
  length: number;
  data: Uint8Array;
}

interface AVSource {
  start(): boolean;
  pause(): boolean;
  reset(): boolean;
}

interface AVXpraSource extends AVSource {
  _on_data(data: Uint8Array): void;
}

interface AVAsset {
  source: AVSource;
  start(): void;
  stop(): void;
  get(event: string, callback: (...args: unknown[]) => void): void;
}

interface AVPlayer {
  playing: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  seek(timestamp: number): void;
  asset: AVAsset;
}

interface AVStatic {
  Buffer: new (data: Uint8Array) => AVBuffer;
  Asset: {
    fromSource(source: AVSource): AVAsset;
  };
  Player: new (asset: AVAsset) => AVPlayer;
  XpraSource: new () => AVXpraSource;
}

declare const AV: AVStatic;
