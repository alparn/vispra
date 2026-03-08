import { describe, it, expect } from "vitest";
import {
  stristrue,
  removeChars,
  trimString,
  convertToHex,
  hexToString,
  arrayhex,
  hexarray,
  StringToUint8,
  Uint8ToString,
  s,
  u,
  ArrayBufferToString,
  ArrayBufferToBase64,
  ToBase64,
  convertDataURIToBinary,
  parseINIString,
  ParseResponseHeaders,
  parseParams,
} from "../encoding";

describe("stristrue", () => {
  it("returns true for truthy string values", () => {
    expect(stristrue("true")).toBe(true);
    expect(stristrue("on")).toBe(true);
    expect(stristrue("1")).toBe(true);
    expect(stristrue("yes")).toBe(true);
    expect(stristrue("enabled")).toBe(true);
  });

  it("returns false for falsy string values", () => {
    expect(stristrue("false")).toBe(false);
    expect(stristrue("off")).toBe(false);
    expect(stristrue("0")).toBe(false);
  });

  it("returns default value for empty/null", () => {
    expect(stristrue("", true)).toBe(true);
    expect(stristrue(null)).toBe(false);
    expect(stristrue(undefined, true)).toBe(true);
  });
});

describe("removeChars", () => {
  it("removes characters not in the valid set", () => {
    expect(removeChars("a-z ", "h3llo w0rld")).toBe("hllo wrld");
  });

  it("keeps only digits", () => {
    expect(removeChars("0-9", "abc123def456")).toBe("123456");
  });
});

describe("trimString", () => {
  it("returns empty for null/undefined", () => {
    expect(trimString(null, 10)).toBe("");
    expect(trimString(undefined, 10)).toBe("");
  });

  it("returns original if shorter than limit", () => {
    expect(trimString("hello", 10)).toBe("hello");
  });

  it("trims and adds ellipsis", () => {
    expect(trimString("hello world", 8)).toBe("hello...");
  });
});

describe("hex conversions", () => {
  it("convertToHex for string", () => {
    expect(convertToHex("AB")).toBe("4142");
  });

  it("convertToHex for Uint8Array", () => {
    expect(convertToHex(new Uint8Array([0x41, 0x42]))).toBe("4142");
  });

  it("hexToString", () => {
    expect(hexToString("4142")).toBe("AB");
  });

  it("arrayhex and hexarray are inverse", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = arrayhex(bytes);
    expect(hex).toBe("deadbeef");
    expect(hexarray(hex)).toEqual(bytes);
  });
});

describe("StringToUint8 / Uint8ToString", () => {
  it("roundtrips", () => {
    const original = "Hello, World!";
    expect(Uint8ToString(StringToUint8(original))).toBe(original);
  });
});

describe("s / u", () => {
  it("s converts Uint8Array to string", () => {
    expect(s(new Uint8Array([72, 105]))).toBe("Hi");
  });

  it("s returns empty for undefined", () => {
    expect(s(undefined)).toBe("");
  });

  it("u converts string to Uint8Array", () => {
    const result = u("Hi");
    expect(result.constructor.name).toBe("Uint8Array");
    expect(Uint8ToString(result)).toBe("Hi");
  });

  it("u returns empty Uint8Array for undefined", () => {
    expect(u(undefined)).toEqual(new Uint8Array(0));
  });
});

describe("ArrayBufferToString", () => {
  it("converts typed array to string", () => {
    const arr = new Uint8Array([72, 101, 108, 108, 111]);
    expect(ArrayBufferToString(arr)).toBe("Hello");
  });

  it("works with plain number array", () => {
    expect(ArrayBufferToString([72, 105])).toBe("Hi");
  });
});

describe("ArrayBufferToBase64", () => {
  it("encodes to base64", () => {
    const arr = new Uint8Array([72, 101, 108, 108, 111]);
    expect(ArrayBufferToBase64(arr)).toBe(btoa("Hello"));
  });
});

describe("ToBase64", () => {
  it("encodes a simple string", () => {
    expect(ToBase64("Hello")).toBe(btoa("Hello"));
  });
});

describe("convertDataURIToBinary", () => {
  it("decodes a data URI", () => {
    const data = btoa("test");
    const uri = `data:text/plain;base64,${data}`;
    const result = convertDataURIToBinary(uri);
    expect(ArrayBufferToString(result)).toBe("test");
  });
});

describe("parseINIString", () => {
  it("parses simple key=value", () => {
    const result = parseINIString("key=value\nfoo=bar");
    expect(result).toEqual({ key: "value", foo: "bar" });
  });

  it("parses sections", () => {
    const result = parseINIString("[section]\nkey=value");
    expect(result).toEqual({ section: { key: "value" } });
  });

  it("ignores comments", () => {
    const result = parseINIString("# comment\nkey=value");
    expect(result).toEqual({ key: "value" });
  });
});

describe("ParseResponseHeaders", () => {
  it("returns empty for null", () => {
    expect(ParseResponseHeaders(null)).toEqual({});
  });

  it("parses header pairs", () => {
    const input = "Content-Type: text/html\r\nX-Custom: value";
    expect(ParseResponseHeaders(input)).toEqual({
      "Content-Type": "text/html",
      "X-Custom": "value",
    });
  });
});

describe("parseParams", () => {
  it("parses query string", () => {
    expect(parseParams("foo=bar&baz=qux")).toEqual({
      foo: "bar",
      baz: "qux",
    });
  });

  it("handles encoded values", () => {
    expect(parseParams("key=hello+world")).toEqual({ key: "hello world" });
  });
});
