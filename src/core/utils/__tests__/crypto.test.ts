import { describe, it, expect } from "vitest";
import {
  getHexUUID,
  getSecureRandomBytes,
  getSecureRandomString,
  xorString,
  u8,
  xor,
} from "../crypto";

describe("getHexUUID", () => {
  it("returns a 36-character UUID-like string", () => {
    const uuid = getHexUUID();
    expect(uuid).toHaveLength(36);
    expect(uuid[8]).toBe("-");
    expect(uuid[13]).toBe("-");
    expect(uuid[18]).toBe("-");
    expect(uuid[23]).toBe("-");
  });

  it("returns different values on each call", () => {
    expect(getHexUUID()).not.toBe(getHexUUID());
  });
});

describe("getSecureRandomBytes", () => {
  it("returns Uint8Array of requested length", () => {
    const bytes = getSecureRandomBytes(16);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(16);
  });
});

describe("getSecureRandomString", () => {
  it("returns a string of requested length", () => {
    const str = getSecureRandomString(8);
    expect(str).toHaveLength(8);
  });
});

describe("xorString", () => {
  it("xors two equal-length strings", () => {
    const a = "AB";
    const b = "\x00\x00";
    expect(xorString(a, b)).toBe("AB");
  });

  it("throws on mismatched lengths", () => {
    expect(() => xorString("AB", "A")).toThrow("strings must be equal length");
  });

  it("xoring a string with itself yields null bytes", () => {
    const s = "Hello";
    const result = xorString(s, s);
    for (let i = 0; i < result.length; i++) {
      expect(result.charCodeAt(i)).toBe(0);
    }
  });
});

describe("u8", () => {
  it("returns Uint8Array as-is", () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(u8(arr)).toBe(arr);
  });

  it("converts string to Uint8Array", () => {
    const result = u8("AB");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result[0]).toBe(65);
    expect(result[1]).toBe(66);
  });

  it("converts ArrayBuffer to Uint8Array", () => {
    const buf = new ArrayBuffer(4);
    const result = u8(buf);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toHaveLength(4);
  });
});

describe("xor", () => {
  it("trims second string to match first length", () => {
    const result = xor("AB", "ABCD");
    expect(result.length).toBe(2);
    for (let i = 0; i < result.length; i++) {
      expect(result.charCodeAt(i)).toBe(0);
    }
  });
});
