/*
 * Author: Ali Parnan
 */

import { log, error as logError } from "../utils/logging";
import { isFirefox, isSafari, isChrome, isMacOS } from "../utils/platform";

export const MediaSourceConstants = {
  CODEC_DESCRIPTION: {
    mp4a: "mpeg4: aac",
    "aac+mpeg4": "mpeg4: aac",
    mp3: "mp3",
    "mp3+id3v2": "mp3",
    "mp3+mpeg4": "mpeg4: mp3",
    wav: "wav",
    wave: "wave",
    flac: "flac",
    opus: "opus",
    vorbis: "vorbis",
    "opus+mka": "webm: opus",
    "opus+ogg": "ogg: opus",
    "vorbis+mka": "webm: vorbis",
    "vorbis+ogg": "ogg: vorbis",
    "speex+ogg": "ogg: speex",
    "flac+ogg": "ogg: flac",
  } as Record<string, string>,

  CODEC_STRING: {
    "aac+mpeg4": 'audio/mp4; codecs="mp4a.40.2"',
    mp3: "audio/mpeg",
    "mp3+mpeg4": 'audio/mp4; codecs="mp3"',
    ogg: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    "opus+mka": 'audio/webm; codecs="opus"',
    "vorbis+mka": 'audio/webm; codecs="vorbis"',
    "vorbis+ogg": 'audio/ogg; codecs="vorbis"',
    "speex+ogg": 'audio/ogg; codecs="speex"',
    "flac+ogg": 'audio/ogg; codecs="flac"',
    "opus+ogg": 'audio/ogg; codecs="opus"',
  } as Record<string, string>,

  PREFERRED_CODEC_ORDER: [
    "opus+mka",
    "vorbis+mka",
    "opus+ogg",
    "vorbis+ogg",
    "opus",
    "vorbis",
    "speex+ogg",
    "flac+ogg",
    "aac+mpeg4",
    "mp3+mpeg4",
    "mp3",
    "mp3+id3v2",
    "flac",
    "wav",
    "wave",
  ] as readonly string[],

  H264_PROFILE_CODE: {
    baseline: "42C0",
    main: "4D40",
    high: "6400",
    extended: "58A0",
  } as Record<string, string>,

  H264_LEVEL_CODE: {
    "3.0": "1E",
    "3.1": "1F",
    "4.1": "29",
    "5.1": "33",
  } as Record<string, string>,

  READY_STATE: {
    0: "NOTHING",
    1: "METADATA",
    2: "CURRENT DATA",
    3: "FUTURE DATA",
    4: "ENOUGH DATA",
  } as Record<number, string>,

  NETWORK_STATE: {
    0: "EMPTY",
    1: "IDLE",
    2: "LOADING",
    3: "NO_SOURCE",
  } as Record<number, string>,

  ERROR_CODE: {
    1: "ABORTED: fetching process aborted by user",
    2: "NETWORK: error occurred when downloading",
    3: "DECODE: error occurred when decoding",
    4: "SRC_NOT_SUPPORTED",
  } as Record<number, string>,

  AURORA_CODECS: {
    wav: "lpcm",
    "mp3+id3v2": "mp3",
    flac: "flac",
    "aac+mpeg4": "mp4a",
  } as Record<string, string>,
} as const;

type MediaSourceConstructor = {
  new (): MediaSource;
  isTypeSupported(type: string): boolean;
};

function getMediaSourceClass(): MediaSourceConstructor | null {
  const win = window as unknown as Record<string, unknown>;
  return (win.MediaSource ?? win.WebKitMediaSource ?? null) as MediaSourceConstructor | null;
}

export function getMediaSource(): MediaSource {
  const MS = getMediaSourceClass();
  if (!MS) throw new Error("no MediaSource support!");
  return new MS();
}

/** Aurora.js (legacy) audio codec detection. */
export function getAuroraAudioCodecs(): Record<string, string> {
  const supported: Record<string, string> = {};
  const failed: Record<string, string> = {};

  const win = globalThis as unknown as Record<string, unknown>;
  const AV = win.AV as
    | { Decoder?: { find?: (codec: string) => unknown } }
    | undefined;

  if (AV?.Decoder?.find) {
    for (const [option, codecString] of Object.entries(
      MediaSourceConstants.AURORA_CODECS,
    )) {
      if (AV.Decoder.find(codecString)) {
        supported[option] = codecString;
      } else {
        failed[option] = codecString;
      }
    }
  }
  log("audio aurora codecs supported:", supported);
  log("audio aurora codecs not available:", failed);
  return supported;
}

export function getMediaSourceAudioCodecs(
  ignoreBlacklist = false,
): Record<string, string> {
  const msClass = getMediaSourceClass();
  if (!msClass) {
    log("audio forwarding: no media source API support");
    return {};
  }

  const supported: Record<string, string> = {};
  const failed: Record<string, string> = {};

  for (const [codecOption, codecString] of Object.entries(
    MediaSourceConstants.CODEC_STRING,
  )) {
    try {
      if (!msClass.isTypeSupported(codecString)) {
        failed[codecOption] = codecString;
        continue;
      }

      let blacklist: string[] = [];
      if (isFirefox() || isSafari()) {
        blacklist = ["opus+mka", "vorbis+mka"];
        if (isSafari()) {
          blacklist.push("wav");
        }
      } else if (isChrome()) {
        blacklist = ["aac+mpeg4"];
        if (isMacOS()) {
          blacklist.push("opus+mka");
        }
      }

      if (blacklist.includes(codecOption)) {
        if (ignoreBlacklist) {
          log("blacklist overruled!");
        } else {
          failed[codecOption] = codecString;
          continue;
        }
      }

      supported[codecOption] = codecString;
    } catch (err) {
      logError(
        `audio error probing codec '${codecOption}' / '${codecString}': ${err}`,
      );
      failed[codecOption] = codecString;
    }
  }

  log("audio codec MediaSource supported:", supported);
  log("audio codec MediaSource not available:", failed);
  return supported;
}

export function getSupportedAudioCodecs(): Record<string, string> {
  const supported = getMediaSourceAudioCodecs();
  const aurora = getAuroraAudioCodecs();
  for (const [option, value] of Object.entries(aurora)) {
    if (!(option in supported)) {
      supported[option] = value;
    }
  }
  return supported;
}

export function getDefaultAudioCodec(
  codecs: Record<string, string> | null,
): string | null {
  if (!codecs) return null;
  const keys = Object.keys(codecs);
  for (const preferred of MediaSourceConstants.PREFERRED_CODEC_ORDER) {
    if (keys.includes(preferred)) return preferred;
  }
  return keys[0] ?? null;
}

export function addMediaSourceEventDebugListeners(
  mediaSource: MediaSource,
  sourceType: string,
): void {
  function debugEvent(event: string) {
    let message = `${sourceType} source ${event}`;
    try {
      message += `: ${mediaSource.readyState}`;
    } catch {
      // ignore
    }
    console.debug(message);
  }
  mediaSource.addEventListener("sourceopen", () => debugEvent("open"));
  mediaSource.addEventListener("sourceended", () => debugEvent("ended"));
  mediaSource.addEventListener("sourceclose", () => debugEvent("close"));
  mediaSource.addEventListener("error", () => debugEvent("error"));
}

export function addMediaElementEventDebugListeners(
  element: HTMLMediaElement,
  elementType: string,
): void {
  function debugEvent(event: string) {
    console.debug(`${elementType} ${event}`);
  }
  const events = [
    "waiting",
    "stalled",
    "playing",
    "loadstart",
    "loadedmetadata",
    "loadeddata",
    "error",
    "canplay",
    "play",
  ] as const;
  for (const ev of events) {
    element.addEventListener(ev, () => debugEvent(ev));
  }
}

export function addSourceBufferEventDebugListeners(
  buffer: SourceBuffer,
  elementType: string,
): void {
  function debugEvent(event: string) {
    console.debug(`${elementType} buffer ${event}`);
  }
  const events = ["updatestart", "updateend", "error", "abort"] as const;
  for (const ev of events) {
    buffer.addEventListener(ev, () => debugEvent(ev));
  }
}

export function getSupportedCodecs(
  mediasource: boolean,
  aurora: boolean,
  ignoreAudioBlacklist = false,
): Record<string, string> {
  const supported: Record<string, string> = {};

  if (mediasource) {
    const msCodecs = getMediaSourceAudioCodecs(ignoreAudioBlacklist);
    for (const [option, _value] of Object.entries(msCodecs)) {
      supported[`mediasource:${option}`] =
        MediaSourceConstants.CODEC_DESCRIPTION[option] ?? option;
    }
  }

  if (aurora) {
    const auroraCodecs = getAuroraAudioCodecs();
    for (const [option, _value] of Object.entries(auroraCodecs)) {
      if (`mediasource:${option}` in supported) continue;
      const desc =
        MediaSourceConstants.CODEC_DESCRIPTION[option] ?? option;
      supported[`aurora:${option}`] = `legacy: ${desc}`;
    }
  }

  return supported;
}

export function getBestCodec(
  codecs: Record<string, string>,
): string | null {
  let bestCodec: string | null = null;
  let bestDistance = MediaSourceConstants.PREFERRED_CODEC_ORDER.length;

  for (const codecOption of Object.keys(codecs)) {
    const cs = codecOption.split(":")[1];
    const distance = MediaSourceConstants.PREFERRED_CODEC_ORDER.indexOf(cs);
    if (distance >= 0 && distance < bestDistance) {
      bestCodec = codecOption;
      bestDistance = distance;
    }
  }
  return bestCodec;
}
