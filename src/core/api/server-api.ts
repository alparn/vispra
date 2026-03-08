/*
 * Author: Ali Parnan
 *
 * XpraServerAPI — HTTP-API client for xpra server endpoints.
 * Wraps the existing jsonAction utility with Promise-based methods
 * for /Info, /Sessions, /Displays, /Menu, and /DesktopMenu.
 */

import { jsonAction } from "@/core/utils/storage";
import { log, warn } from "@/core/utils/logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerInfo {
  mode: string;
  [key: string]: unknown;
}

export interface SessionAttributes {
  "session-name"?: string;
  "session-type"?: string;
  username?: string;
  [key: string]: unknown;
}

/** Keyed by display id, e.g. ":100" */
export type SessionsResponse = Record<string, SessionAttributes>;

export interface DisplayAttributes {
  wmname?: string;
  [key: string]: unknown;
}

/** Keyed by display id, e.g. ":0" */
export type DisplaysResponse = Record<string, DisplayAttributes>;

export interface MenuEntry {
  Name: string;
  Exec?: string;
  TryExec?: string;
  Icon?: string;
  [key: string]: unknown;
}

export interface MenuCategory {
  Entries: Record<string, MenuEntry>;
  [key: string]: unknown;
}

/** Keyed by category name */
export type MenuResponse = Record<string, MenuCategory>;

export interface DesktopMenuEntry {
  Name?: string;
  Exec?: string;
  TryExec?: string;
  Icon?: string;
  [key: string]: unknown;
}

/** Keyed by desktop session name */
export type DesktopMenuResponse = Record<string, DesktopMenuEntry>;

export interface AuthCredentials {
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBaseUrl(host: string, port: number, ssl: boolean): string {
  const proto = ssl ? "https" : "http";
  return `${proto}://${host}:${port}`;
}

function jsonGet<T>(
  url: string,
  auth?: AuthCredentials,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    jsonAction(
      url,
      (_xhr, response) => resolve(response as T),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      auth?.username,
      auth?.password,
    );
  });
}

// ---------------------------------------------------------------------------
// XpraServerAPI
// ---------------------------------------------------------------------------

export class XpraServerAPI {
  private readonly baseUrl: string;
  private readonly auth?: AuthCredentials;

  constructor(options: {
    host: string;
    port: number;
    ssl?: boolean;
    auth?: AuthCredentials;
  }) {
    this.baseUrl = buildBaseUrl(options.host, options.port, options.ssl ?? false);
    this.auth = options.auth;
  }

  private url(endpoint: string): string {
    return `${this.baseUrl}/${endpoint}`;
  }

  /**
   * GET /Info — returns server mode and basic information.
   * The `mode` field indicates the server type: "seamless", "desktop", "shadow", or "".
   */
  async fetchInfo(): Promise<ServerInfo> {
    log("XpraServerAPI: fetching /Info from", this.baseUrl);
    try {
      const response = await jsonGet<ServerInfo>(this.url("Info"), this.auth);
      log("XpraServerAPI: /Info response:", response);
      return response;
    } catch (err) {
      warn("XpraServerAPI: /Info failed:", err);
      throw err;
    }
  }

  /**
   * GET /Sessions — returns available sessions keyed by display id.
   * Each entry has session-name, session-type, username, etc.
   */
  async fetchSessions(): Promise<SessionsResponse> {
    log("XpraServerAPI: fetching /Sessions from", this.baseUrl);
    try {
      const response = await jsonGet<SessionsResponse>(this.url("Sessions"), this.auth);
      log("XpraServerAPI: /Sessions response:", response);
      return response;
    } catch (err) {
      warn("XpraServerAPI: /Sessions failed:", err);
      throw err;
    }
  }

  /**
   * GET /Displays — returns available displays for shadow mode.
   * Each entry may have a `wmname` field.
   */
  async fetchDisplays(): Promise<DisplaysResponse> {
    log("XpraServerAPI: fetching /Displays from", this.baseUrl);
    try {
      const response = await jsonGet<DisplaysResponse>(this.url("Displays"), this.auth);
      log("XpraServerAPI: /Displays response:", response);
      return response;
    } catch (err) {
      warn("XpraServerAPI: /Displays failed:", err);
      throw err;
    }
  }

  /**
   * GET /Menu — returns startable applications grouped by category.
   * Used for seamless session mode to choose which application to launch.
   */
  async fetchMenu(): Promise<MenuResponse> {
    log("XpraServerAPI: fetching /Menu from", this.baseUrl);
    try {
      const response = await jsonGet<MenuResponse>(this.url("Menu"), this.auth);
      log("XpraServerAPI: /Menu response:", response);
      return response;
    } catch (err) {
      warn("XpraServerAPI: /Menu failed:", err);
      throw err;
    }
  }

  /**
   * GET /DesktopMenu — returns startable desktop sessions.
   * Used for desktop session mode to choose which desktop environment to launch.
   */
  async fetchDesktopMenu(): Promise<DesktopMenuResponse> {
    log("XpraServerAPI: fetching /DesktopMenu from", this.baseUrl);
    try {
      const response = await jsonGet<DesktopMenuResponse>(this.url("DesktopMenu"), this.auth);
      log("XpraServerAPI: /DesktopMenu response:", response);
      return response;
    } catch (err) {
      warn("XpraServerAPI: /DesktopMenu failed:", err);
      throw err;
    }
  }

  /**
   * Convenience method: fetch all relevant server info in parallel.
   * Failures on individual endpoints are caught and returned as null.
   */
  async fetchAll(): Promise<{
    info: ServerInfo | null;
    sessions: SessionsResponse | null;
    displays: DisplaysResponse | null;
    menu: MenuResponse | null;
    desktopMenu: DesktopMenuResponse | null;
  }> {
    const [info, sessions, displays, menu, desktopMenu] = await Promise.all([
      this.fetchInfo().catch(() => null),
      this.fetchSessions().catch(() => null),
      this.fetchDisplays().catch(() => null),
      this.fetchMenu().catch(() => null),
      this.fetchDesktopMenu().catch(() => null),
    ]);
    return { info, sessions, displays, menu, desktopMenu };
  }
}
