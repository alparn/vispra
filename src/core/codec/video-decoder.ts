/*
 * Author: Ali Parnan
 */

/**
 * Minimal draw-packet shape used by the video decoder.
 * Full type lives in rgb-helpers.ts; here we only declare what we touch.
 */
export type VideoDrawPacket = [
  string,          // [0] type
  number,          // [1] wid
  number,          // [2] x
  number,          // [3] y
  number,          // [4] width
  number,          // [5] height
  string,          // [6] coding
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,             // [7] data / VideoFrame
  number,          // [8] packet_sequence
  number,          // [9] rowstride
  Record<string, unknown>, // [10] options
];

interface QueueEntry {
  p: VideoDrawPacket;
}

export function hasNativeVideoDecoder(): boolean {
  return typeof VideoDecoder !== "undefined";
}

export class XpraVideoDecoder {
  private initialized = false;
  private hadFirstKey = false;
  private draining = false;

  private decoderQueue: QueueEntry[] = [];
  private decodedFrames: VideoDrawPacket[] = [];
  private erroneousFrame: string | null = null;

  private codec: string | null = null;
  private vp9Params: string | null = null;
  private frameWaitTimeout = 1;
  private frameThreshold = 250;
  private lastTimestamp = 0;
  private videoDecoder: VideoDecoder | null = null;

  /** Public getter for offscreen-decode-worker to check if decoder is ready. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  prepareVP9Params(csc: string): void {
    if (csc === "YUV444P" && this.vp9Params !== ".01.10.08") {
      this.vp9Params = ".01.10.08";
      this.close();
    } else if (csc === "YUV444P10" && this.vp9Params !== ".03.10.10") {
      this.vp9Params = ".03.10.10";
      this.close();
    } else if (this.vp9Params !== ".00.20.08.01.02.02") {
      this.vp9Params = ".00.20.08.01.02.02";
      this.close();
    }
  }

  init(coding: string): void {
    this.draining = false;
    this.codec = this.resolveCodec(coding);

    this.videoDecoder = new VideoDecoder({
      output: this.onDecodedFrame.bind(this),
      error: this.onDecoderError.bind(this),
    });

    this.videoDecoder.configure({
      codec: this.codec,
      hardwareAcceleration: "no-preference",
      optimizeForLatency: true,
    });

    this.lastTimestamp = 0;
    this.initialized = true;
  }

  private resolveCodec(coding: string): string {
    if (coding === "h264") return "avc1.42C01E";
    if (coding === "vp8") return "vp8";
    if (coding === "vp9") return `vp09${this.vp9Params}`;
    throw new Error(`No codec defined for coding ${coding}`);
  }

  private onDecodedFrame(videoFrame: VideoFrame): void {
    if (this.decoderQueue.length === 0) {
      videoFrame.close();
      return;
    }

    const frameTimestamp = videoFrame.timestamp;
    const matches = this.decoderQueue.filter(
      (q) => (q.p[10]["frame"] as number) === frameTimestamp,
    );

    if (matches.length !== 1) {
      videoFrame.close();
      return;
    }

    this.decoderQueue = this.decoderQueue.filter(
      (q) => (q.p[10]["frame"] as number) !== frameTimestamp,
    );
    const currentFrame = matches[0];

    if (frameTimestamp === 0) {
      this.lastTimestamp = 0;
    }

    if (
      this.decoderQueue.length > this.frameThreshold ||
      this.lastTimestamp > frameTimestamp
    ) {
      videoFrame.close();
      const packet = currentFrame.p;
      packet[6] = "throttle";
      packet[7] = null;
      this.decodedFrames.push(packet);
      return;
    }

    this.lastTimestamp = frameTimestamp;
    const packet = currentFrame.p;

    if (this.draining) {
      videoFrame.close();
      return;
    }

    packet[6] = `frame:${packet[6]}`;
    packet[7] = videoFrame;
    this.decodedFrames.push(packet);
  }

  private onDecoderError(err: DOMException): void {
    this.erroneousFrame = `Error decoding frame: ${err}`;
    console.error(this.erroneousFrame);
  }

  async queueFrame(packet: VideoDrawPacket): Promise<VideoDrawPacket> {
    const options = (packet[10] ?? {}) as Record<string, unknown>;
    const data = packet[7] as BufferSource;
    const packetSequence = packet[8];

    if (
      this.codec?.startsWith("avc1") &&
      !this.hadFirstKey &&
      options["type"] !== "IDR"
    ) {
      throw new Error(
        `first h264 frame must be a key frame but packet ${packetSequence} is not`,
      );
    }

    if (!this.videoDecoder || this.videoDecoder.state === "closed") {
      throw new Error("video decoder is closed");
    }
    if (this.draining) {
      throw new Error("video decoder is draining");
    }

    this.hadFirstKey = true;
    this.decoderQueue.push({ p: packet });

    const chunk = new EncodedVideoChunk({
      type: options["type"] === "IDR" ? "key" : "delta",
      data,
      timestamp: options["frame"] as number,
    });

    try {
      this.videoDecoder.decode(chunk);
    } catch (err) {
      throw new Error(`failed to decode chunk: ${err}`);
    }

    let frameOut = this.decodedFrames.filter(
      (p) => p[8] === packetSequence,
    );

    while (frameOut.length === 0) {
      await new Promise<void>((r) => setTimeout(r, this.frameWaitTimeout));
      if (this.erroneousFrame != null) break;
      frameOut = this.decodedFrames.filter(
        (p) => p[8] === packetSequence,
      );
    }

    if (this.erroneousFrame != null) {
      const msg = this.erroneousFrame;
      this.erroneousFrame = null;
      throw new Error(msg);
    }

    this.decodedFrames = this.decodedFrames.filter(
      (p) => p[8] !== packetSequence,
    );
    return frameOut[0];
  }

  close(): void {
    if (this.initialized) {
      if (this.videoDecoder && this.videoDecoder.state !== "closed") {
        this.videoDecoder.close();
      }
      this.hadFirstKey = false;
      this.draining = true;
      this.decoderQueue = [];
    }
    this.initialized = false;
  }
}
