/*
 * Author: Ali Parnan
 */

import { clog, cdebug } from "./logging";
import { ArrayBufferToString } from "./encoding.js";

export function getHexUUID(): string {
  const s: string[] = [];
  const hexDigits = "0123456789abcdef";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s[i] = "-";
    } else {
      s[i] = hexDigits[Math.floor(Math.random() * 16)];
    }
  }
  return s.join("");
}

export function getSecureRandomBytes(len: number): Uint8Array {
  const u = new Uint8Array(len);
  crypto.getRandomValues(u);
  return u;
}

export function getSecureRandomString(len: number): string {
  const u = getSecureRandomBytes(len);
  return String.fromCharCode.apply(null, u as unknown as number[]);
}

export function xorString(string1: string, string2: string): string {
  if (string1.length !== string2.length) {
    throw new Error("strings must be equal length");
  }
  let result = "";
  for (let i = 0; i < string1.length; i++) {
    result += String.fromCharCode(
      string1.charCodeAt(i) ^ string2.charCodeAt(i),
    );
  }
  return result;
}

export function u8(value: Uint8Array | string | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return Uint8Array.from(value.split("").map((x) => x.charCodeAt(0)));
  }
  return new Uint8Array(value);
}

export function xor(str1: string, str2: string): string {
  const trimmed = str2.slice(0, str1.length);
  return xorString(str1, trimmed);
}

function normalizeHashName(digest: string): string {
  let hash = "SHA-1";
  if (digest.indexOf("+") > 0) {
    hash = digest.split("+")[1];
  }
  hash = hash.toUpperCase();
  if (hash.startsWith("SHA") && !hash.startsWith("SHA-")) {
    hash = "SHA-" + hash.substring(3);
  }
  return hash;
}

export async function gendigest(
  digest: string,
  password: string,
  salt: string,
): Promise<string> {
  if (digest === "xor") {
    const trimmedSalt = salt.slice(0, password.length);
    return xorString(trimmedSalt, password);
  }

  if (!digest.startsWith("hmac")) {
    throw new Error(`unsupported digest '${digest}'`);
  }

  const hash = normalizeHashName(digest);

  if (typeof crypto.subtle === "undefined") {
    throw new Error("crypto.subtle API is not available in this context");
  }

  clog("crypto.subtle=", crypto.subtle);
  clog("crypto.subtle.importKey=", crypto.subtle.importKey);

  const passwordBytes = u8(password);
  const key = await crypto.subtle.importKey(
    "raw",
    passwordBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash },
    false,
    ["sign", "verify"],
  );
  cdebug("imported hmac key: ", key);

  const saltBytes = u8(salt);
  const result = await crypto.subtle.sign("HMAC", key, saltBytes.buffer as ArrayBuffer);
  const u8digest = new Uint8Array(result);
  clog("hmac result=", u8digest);
  return ArrayBufferToString(u8digest);
}
