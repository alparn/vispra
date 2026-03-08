import { describe, it, expect } from "vitest";
import {
  MediaSourceConstants,
  getDefaultAudioCodec,
  getBestCodec,
} from "../media-source";

describe("MediaSourceConstants", () => {
  it("has expected codec descriptions", () => {
    expect(MediaSourceConstants.CODEC_DESCRIPTION["mp3"]).toBe("mp3");
    expect(MediaSourceConstants.CODEC_DESCRIPTION["opus+mka"]).toBe(
      "webm: opus",
    );
  });

  it("has expected codec strings", () => {
    expect(MediaSourceConstants.CODEC_STRING["mp3"]).toBe("audio/mpeg");
    expect(MediaSourceConstants.CODEC_STRING["opus+mka"]).toBe(
      'audio/webm; codecs="opus"',
    );
  });

  it("PREFERRED_CODEC_ORDER starts with opus+mka", () => {
    expect(MediaSourceConstants.PREFERRED_CODEC_ORDER[0]).toBe("opus+mka");
  });

  it("has H264 profile codes", () => {
    expect(MediaSourceConstants.H264_PROFILE_CODE["baseline"]).toBe("42C0");
    expect(MediaSourceConstants.H264_PROFILE_CODE["high"]).toBe("6400");
  });

  it("has H264 level codes", () => {
    expect(MediaSourceConstants.H264_LEVEL_CODE["3.0"]).toBe("1E");
    expect(MediaSourceConstants.H264_LEVEL_CODE["5.1"]).toBe("33");
  });

  it("has READY_STATE descriptions", () => {
    expect(MediaSourceConstants.READY_STATE[0]).toBe("NOTHING");
    expect(MediaSourceConstants.READY_STATE[4]).toBe("ENOUGH DATA");
  });

  it("has ERROR_CODE descriptions", () => {
    expect(MediaSourceConstants.ERROR_CODE[3]).toBe(
      "DECODE: error occurred when decoding",
    );
  });

  it("has AURORA_CODECS mappings", () => {
    expect(MediaSourceConstants.AURORA_CODECS["wav"]).toBe("lpcm");
    expect(MediaSourceConstants.AURORA_CODECS["flac"]).toBe("flac");
  });
});

describe("getDefaultAudioCodec", () => {
  it("returns null for null input", () => {
    expect(getDefaultAudioCodec(null)).toBeNull();
  });

  it("returns the highest-priority codec available", () => {
    const codecs = {
      mp3: "audio/mpeg",
      "opus+mka": 'audio/webm; codecs="opus"',
      flac: "audio/flac",
    };
    expect(getDefaultAudioCodec(codecs)).toBe("opus+mka");
  });

  it("returns first key if no preferred codec matches", () => {
    const codecs = { "custom-codec": "audio/custom" };
    expect(getDefaultAudioCodec(codecs)).toBe("custom-codec");
  });

  it("returns null for empty object", () => {
    expect(getDefaultAudioCodec({})).toBeNull();
  });
});

describe("getBestCodec", () => {
  it("returns null for empty codecs", () => {
    expect(getBestCodec({})).toBeNull();
  });

  it("selects the codec closest to the front of the preferred order", () => {
    const codecs = {
      "mediasource:mp3": "mp3",
      "mediasource:opus+mka": "webm: opus",
      "aurora:flac": "legacy: flac",
    };
    expect(getBestCodec(codecs)).toBe("mediasource:opus+mka");
  });

  it("ignores codecs not in the preferred order", () => {
    const codecs = {
      "mediasource:unknown": "something",
      "mediasource:wav": "wav",
    };
    expect(getBestCodec(codecs)).toBe("mediasource:wav");
  });
});
