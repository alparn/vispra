/*
 * Author: Ali Parnan
 *
 * System packet handlers: ping, ping_echo, encodings, info_response,
 * setting_change, control, notify_show, notify_close, open_url.
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";
import { s } from "@/core/utils/encoding";
import { ToBase64 } from "@/core/utils/encoding";
import type {
  ControlPacket,
  EncodingsPacket,
  InfoResponsePacket,
  NotifyClosePacket,
  NotifyShowPacket,
  OpenUrlPacket,
  PingEchoPacket,
  PingPacket,
  ServerPacket,
  SettingChangePacket,
} from "@/core/protocol/types";
import type { HandlerContext } from "./types";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handlePing(packet: PingPacket, ctx: HandlerContext): void {
  const echotime = packet[1];
  let lastPingServerTime = echotime;
  if (packet.length > 2) {
    lastPingServerTime = packet[2] ?? echotime;
  }
  let sid = "";
  if (packet.length >= 4) {
    sid = String(packet[3] ?? "");
  }

  ctx.setLastPing?.(Date.now(), lastPingServerTime);
  ctx.send([
    PACKET_TYPES.ping_echo,
    echotime,
    0,
    0,
    0,
    0,
    sid,
  ]);
}

export function handlePingEcho(packet: PingEchoPacket, ctx: HandlerContext): void {
  const lastPingEchoedTime = packet[1];
  const l1 = packet[2];
  const l2 = packet[3];
  const l3 = packet[4];
  const clientPingLatency = packet[5];

  ctx.setPingEcho?.(lastPingEchoedTime, [l1 / 1000, l2 / 1000, l3 / 1000], clientPingLatency);
}

export function handleEncodings(packet: EncodingsPacket, ctx: HandlerContext): void {
  const caps = packet[1];
  ctx.log?.("update encodings:", Object.keys(caps));
}

export function handleInfoResponse(
  packet: InfoResponsePacket,
  ctx: HandlerContext,
): void {
  const info = packet[1];
  ctx.setInfoRequestPending?.(false);
  ctx.setServerLastInfo?.(info);
  ctx.dispatchInfoResponse?.(info);
}

export function handleSettingChange(
  packet: SettingChangePacket,
  ctx: HandlerContext,
): void {
  const name = packet[1];
  const value = packet[2];
  ctx.onSettingChange?.(name, value);
}

export function handleControl(packet: ControlPacket, ctx: HandlerContext): void {
  const action = packet[1];
  ctx.log?.("control:", action, packet);

  if (action === "log") {
    ctx.log?.("log action:", packet);
  } else if (action === "redraw") {
    ctx.redrawWindows?.();
  } else if (action === "stop-audio") {
    ctx.closeAudio?.();
  } else if (action === "toggle-keyboard") {
    ctx.toggleKeyboard?.();
  } else if (action === "toggle-float-menu") {
    ctx.toggleFloatMenu?.();
  } else if (action === "toggle-window-preview") {
    ctx.toggleWindowPreview?.();
  } else {
    ctx.warn?.("unhandled control action:", action);
  }
}

export function handleNotifyShow(
  packet: NotifyShowPacket,
  ctx: HandlerContext,
): void {
  const nid = packet[2];
  const replacesNid = packet[4];
  const summary = s(packet[6]);
  const body = s(packet[7]);
  const expireTimeout = packet[8];
  const icon = packet[9];
  const actions = packet[10] ?? [];
  const hints = packet[11] ?? {};

  if (ctx.closeNotification) {
    if (replacesNid > 0) ctx.closeNotification(replacesNid);
    ctx.closeNotification(nid);
  }

  const doNotify = (): void => {
    let iconUrl = "";
    if (icon && Array.isArray(icon) && icon[0] === "png" && icon[3]) {
      iconUrl = `data:image/png;base64,${ToBase64(icon[3])}`;
    }

    if (typeof Notification !== "undefined" && actions.length === 0) {
      if (Notification.permission === "granted") {
        const notification = new Notification(summary, { body, icon: iconUrl });
        notification.addEventListener("close", () =>
          ctx.send([PACKET_TYPES.notification_close, nid, 2, ""]),
        );
        return;
      }
      if (Notification.permission !== "denied") {
        Notification.requestPermission((permission) => {
          if (permission === "granted") doNotify();
        });
      }
      return;
    }

    ctx.doNotification?.("info", nid, summary, body, expireTimeout, icon, actions, hints);
  };

  doNotify();
}

export function handleNotifyClose(
  packet: NotifyClosePacket,
  ctx: HandlerContext,
): void {
  const nid = packet[1];
  ctx.closeNotification?.(nid);
}

export function handleOpenUrl(packet: OpenUrlPacket, _ctx: HandlerContext): void {
  const url = packet[1];
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const systemHandlers: Partial<
  Record<string, (p: ServerPacket, ctx: HandlerContext) => void>
> = {
  [PACKET_TYPES.ping]: handlePing as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.ping_echo]:
    handlePingEcho as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.encodings]:
    handleEncodings as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.info_response]:
    handleInfoResponse as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.setting_change]:
    handleSettingChange as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.control]:
    handleControl as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.notify_show]:
    handleNotifyShow as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.notify_close]:
    handleNotifyClose as (p: ServerPacket, ctx: HandlerContext) => void,
  [PACKET_TYPES.open_url]:
    handleOpenUrl as (p: ServerPacket, ctx: HandlerContext) => void,
};
