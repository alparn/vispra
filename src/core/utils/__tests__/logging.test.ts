import { describe, it, expect, vi } from "vitest";
import {
  console_log_safe,
  console_warn_safe,
  console_error_safe,
  console_debug_safe,
  log,
  setLogHandler,
  setWarnHandler,
  setErrorHandler,
  setDebugHandler,
} from "../logging";

describe("console_*_safe functions", () => {
  it("console_log_safe calls console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    console_log_safe("test");
    expect(spy).toHaveBeenCalledWith("test");
    spy.mockRestore();
  });

  it("console_warn_safe calls console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    console_warn_safe("test");
    expect(spy).toHaveBeenCalledWith("test");
    spy.mockRestore();
  });

  it("console_error_safe calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    console_error_safe("test");
    expect(spy).toHaveBeenCalledWith("test");
    spy.mockRestore();
  });

  it("console_debug_safe calls console.debug", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    console_debug_safe("test");
    expect(spy).toHaveBeenCalledWith("test");
    spy.mockRestore();
  });
});

describe("redirectable log functions", () => {
  it("log defaults to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("setLogHandler redirects log calls", async () => {
    const custom = vi.fn();
    setLogHandler(custom);
    const { log: currentLog } = await import("../logging");
    currentLog("redirected");
    expect(custom).toHaveBeenCalledWith("redirected");
    setLogHandler(console_log_safe);
  });

  it("setWarnHandler redirects warn calls", async () => {
    const custom = vi.fn();
    setWarnHandler(custom);
    const { warn: currentWarn } = await import("../logging");
    currentWarn("redirected");
    expect(custom).toHaveBeenCalledWith("redirected");
    setWarnHandler(console_warn_safe);
  });

  it("setErrorHandler redirects error and exc calls", async () => {
    const custom = vi.fn();
    setErrorHandler(custom);
    const { error: currentError, exc: currentExc } = await import("../logging");
    currentError("err");
    currentExc("exc");
    expect(custom).toHaveBeenCalledWith("err");
    expect(custom).toHaveBeenCalledWith("exc");
    setErrorHandler(console_error_safe);
  });

  it("setDebugHandler redirects debug calls", async () => {
    const custom = vi.fn();
    setDebugHandler(custom);
    const { debug: currentDebug } = await import("../logging");
    currentDebug("dbg");
    expect(custom).toHaveBeenCalledWith("dbg");
    setDebugHandler(console_debug_safe);
  });
});
