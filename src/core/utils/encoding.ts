/*
 * Author: Ali Parnan
 */

export function stristrue(
  v: unknown,
  defaultValue?: boolean,
): boolean {
  if (!v) return defaultValue ?? false;
  return ["true", "on", "1", "yes", "enabled"].includes(
    String(v).toLowerCase(),
  );
}

export function removeChars(validChars: string, inputString: string): string {
  return inputString.replace(new RegExp("[^" + validChars + "]", "g"), "");
}

export function trimString(str: string | undefined | null, trimLength: number): string {
  if (!str) return "";
  return str.length > trimLength
    ? `${str.slice(0, Math.max(0, trimLength - 3))}...`
    : str;
}

export function convertToHex(value: Uint8Array | string): string {
  if (value instanceof Uint8Array) return arrayhex(value);
  let hex = "";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToString(hexval: string): string {
  const hex = hexval.toString();
  let str = "";
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return str;
}

export function arrayhex(arr: Uint8Array | number[]): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexarray(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function StringToUint8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function Uint8ToString(value: Uint8Array | ArrayBuffer): string {
  return new TextDecoder().decode(value);
}

/** Convert any value to a string, handling Uint8Array transparently. */
export function s(v: unknown): string {
  if (v === undefined) return "";
  if (v instanceof Uint8Array) return Uint8ToString(v);
  return String(v);
}

/** Convert any value to a Uint8Array, handling strings transparently. */
export function u(v: unknown): Uint8Array {
  if (v === undefined) return new Uint8Array(0);
  if (v instanceof Uint8Array) return v;
  return StringToUint8(String(v));
}

/**
 * Convert a typed array / array-like to a string via `String.fromCharCode`,
 * processing in chunks of 10400 to avoid call-stack overflows.
 */
export function ArrayBufferToString(
  uintArray: Uint8Array | number[],
): string {
  let result = "";
  const CHUNK = 10_400;
  const len = uintArray.length;
  const slice =
    "subarray" in uintArray
      ? (s: number, e: number) => (uintArray as Uint8Array).subarray(s, e)
      : (s: number, e: number) => (uintArray as number[]).slice(s, e);

  for (let i = 0; i < len; i += CHUNK) {
    result += String.fromCharCode.apply(
      null,
      slice(i, Math.min(i + CHUNK, len)) as unknown as number[],
    );
  }
  return result;
}

export function ArrayBufferToBase64(uintArray: Uint8Array): string {
  return btoa(ArrayBufferToString(uintArray));
}

export function ToBase64(v: string | Uint8Array): string {
  try {
    return btoa(v as string);
  } catch {
    return ArrayBufferToBase64(v as Uint8Array);
  }
}

export function convertDataURIToBinary(dataURI: string): Uint8Array {
  const BASE64_MARKER = ";base64,";
  const base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
  const raw = atob(dataURI.slice(Math.max(0, base64Index)));
  const array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    array[i] = raw.charCodeAt(i);
  }
  return array;
}

export function parseINIString(
  data: string,
): Record<string, string | Record<string, string>> {
  const regex = {
    section: /^\s*\[\s*([^\]]*)\s*]\s*$/,
    param: /^\s*([^=]+?)\s*=\s*(.*?)\s*$/,
    comment: /^\s*[#;].*$/,
  };
  const result: Record<string, string | Record<string, string>> = {};
  const lines = data.split(/[\n\r]+/);
  let section: string | null = null;

  for (const line of lines) {
    if (regex.comment.test(line)) {
      continue;
    } else if (regex.param.test(line)) {
      const match = line.match(regex.param)!;
      if (section) {
        (result[section] as Record<string, string>)[match[1]] = match[2];
      } else {
        result[match[1]] = match[2];
      }
    } else if (regex.section.test(line)) {
      const match = line.match(regex.section)!;
      result[match[1]] = {};
      section = match[1];
    } else if (line.length === 0 && section) {
      section = null;
    }
  }
  return result;
}

export function ParseResponseHeaders(
  headerString: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headerString) return headers;

  const pairs = headerString.split("\u000D\u000A");
  for (const pair of pairs) {
    const idx = pair.indexOf("\u003A\u0020");
    if (idx > 0) {
      headers[pair.slice(0, idx)] = pair.slice(idx + 2);
    }
  }
  return headers;
}

export function parseParams(q: string): Record<string, string> {
  const params: Record<string, string> = {};
  const plusRe = /\+/g;
  const pairRe = /([^&=]+)=?([^&]*)/g;
  const decode = (s: string) => decodeURIComponent(s.replace(plusRe, " "));
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(q))) {
    params[decode(match[1])] = decode(match[2]);
  }
  return params;
}
