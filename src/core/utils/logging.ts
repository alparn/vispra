/*
 * Author: Ali Parnan
 */

export function console_log_safe(...args: unknown[]): void {
  if (console) console.log(...args);
}

export function console_warn_safe(...args: unknown[]): void {
  if (console) console.warn(...args);
}

export function console_error_safe(...args: unknown[]): void {
  if (console) console.error(...args);
}

export function console_debug_safe(...args: unknown[]): void {
  if (console) console.debug(...args);
}

/**
 * Redirectable log functions. Consumers can reassign these to route
 * output through custom logging infrastructure while the `c*` variants
 * always go directly to the console.
 */
export let log: (...args: unknown[]) => void = console_log_safe;
export let warn: (...args: unknown[]) => void = console_warn_safe;
export let error: (...args: unknown[]) => void = console_error_safe;
export let exc: (...args: unknown[]) => void = console_error_safe;
export let debug: (...args: unknown[]) => void = console_debug_safe;

export const clog = console_log_safe;
export const cwarn = console_warn_safe;
export const cerror = console_error_safe;
export const cexc = console_error_safe;
export const cdebug = console_debug_safe;

export function setLogHandler(handler: (...args: unknown[]) => void): void {
  log = handler;
}

export function setWarnHandler(handler: (...args: unknown[]) => void): void {
  warn = handler;
}

export function setErrorHandler(handler: (...args: unknown[]) => void): void {
  error = handler;
  exc = handler;
}

export function setDebugHandler(handler: (...args: unknown[]) => void): void {
  debug = handler;
}
