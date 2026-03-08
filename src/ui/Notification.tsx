/*
 * Author: Ali Parnan
 *
 * Notification — In-app notification (fallback when browser Notification API unavailable).
 * Phase 6b-3.
 */

import type { Component } from "solid-js";
import { For } from "solid-js";
import { notificationsStore, closeNotification } from "@/store";
import "./Notification.css";

export const Notification: Component = () => {
  const list = () => notificationsStore.notifications;

  return (
    <div class="notifications" aria-live="polite">
      <For each={list()}>
        {(n) => (
          <div
            class={`notification alert alert-${n.type || "info"}`}
            data-nid={n.id}
          >
            {n.icon && (
              <img class="notification-icon" src={n.icon} alt="" />
            )}
            <span class="notification-title">{n.title}</span>
            <span class="notification-message">{n.message}</span>
            {n.actions && n.actions.length > 0 && (
              <div class="notification-buttons">
                {n.actions.map(([actionId, label]) => (
                  <button
                    type="button"
                    class="notification-button"
                    onClick={() => {
                      n.onAction?.(n.id, actionId);
                      closeNotification(n.id, 3, "user clicked action");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              class="notification-dismiss"
              aria-label="Dismiss"
              onClick={() => closeNotification(n.id, 2, "user dismiss")}
            >
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
};
