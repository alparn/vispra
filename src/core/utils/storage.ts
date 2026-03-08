/*
 * Author: Ali Parnan
 */

import { log } from "./logging";
import { parseParams } from "./encoding";

export function isSafeHost(host: string | undefined | null): boolean {
  return !!host && ["localhost", "127.0.0.1", "::1"].includes(host);
}

export function hasSessionStorage(): boolean {
  if (typeof Storage === "undefined") return false;
  try {
    const key = "just for testing sessionStorage support";
    sessionStorage.setItem(key, "store-whatever");
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function getSessionStoragePrefix(): string {
  const urlPath = new URL(window.location.href).pathname;
  return urlPath.substring(0, urlPath.lastIndexOf("/"));
}

export function getSessionStorageValue(
  property: string,
): string | undefined {
  const raw = sessionStorage.getItem(getSessionStoragePrefix());
  const params: Record<string, string> = raw ? JSON.parse(raw) : {};
  if (property in params) return String(params[property]);
  return undefined;
}

export function setSessionStorageValue(
  property: string,
  value: string | null | undefined,
): void {
  const prefix = getSessionStoragePrefix();
  const raw = sessionStorage.getItem(prefix);
  const params: Record<string, string> = raw ? JSON.parse(raw) : {};
  if (value === null || value === undefined || value === "undefined") {
    delete params[property];
  } else {
    params[property] = String(value);
  }
  sessionStorage.setItem(prefix, JSON.stringify(params));
}

export function clearSessionStorage(): void {
  sessionStorage.removeItem(getSessionStoragePrefix());
}

export function getparam(property: string): string | undefined {
  const loc = window.location as unknown as Record<string, unknown>;
  let getParameter = loc.getParameter as
    | ((key: string) => string | undefined)
    | undefined;

  if (!getParameter) {
    getParameter = (key: string): string | undefined => {
      if (!(loc as Record<string, unknown>).queryStringParams) {
        (loc as Record<string, unknown>).queryStringParams = parseParams(
          window.location.search.slice(1),
        );
      }
      return (
        (loc as Record<string, unknown>).queryStringParams as Record<
          string,
          string
        >
      )[key];
    };
  }

  let value = getParameter(property);
  if (value === undefined) {
    try {
      value = getSessionStorageValue(property);
    } catch {
      // sessionStorage may not be available
    }
  }
  return value;
}

export function jsonAction(
  uri: string,
  onSuccess: (xhr: XMLHttpRequest, response: unknown) => void,
  onError?: (error: unknown) => void,
  username?: string,
  password?: string,
): XMLHttpRequest {
  log("json_action(", uri, ", ", onSuccess, ", ", onError, ")");

  const xhr = new XMLHttpRequest();
  let url = uri;
  if (uri.startsWith("/")) {
    url = document.location.href.split("/connect.html")[0] + uri;
  }
  xhr.open("GET", url, true);
  if (username && password) {
    xhr.setRequestHeader("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
  }
  xhr.responseType = "json";

  xhr.addEventListener("load", () => {
    log("loaded", url, "status", xhr.status);
    if (xhr.status === 200) {
      onSuccess(xhr, xhr.response);
    } else {
      log(uri, "failed:", xhr.status, xhr.response);
      onError?.(`failed: ${xhr.status}${xhr.response}`);
    }
  });
  xhr.addEventListener("error", (e) => {
    log(uri, "error:", e);
    onError?.(e);
  });
  xhr.addEventListener("abort", (e) => {
    log(uri, "abort:", e);
    onError?.(e);
  });
  xhr.send();
  return xhr;
}
