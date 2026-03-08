/*
 * Author: Ali Parnan
 *
 * Notifications store — In-app notifications (fallback when browser Notification API unavailable).
 * Phase 6b-3: Notification component.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  icon?: string;
  timeout?: number;
  actions?: [string, string][];
  onAction?: (nid: number, actionId: string) => void;
  onClose?: (nid: number, reason: number, detail: string) => void;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const [notifications, setNotifications] = createSignal<NotificationItem[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function addNotification(
  type: string,
  title: string,
  message: string,
  options?: {
    icon?: string;
    timeout?: number;
    actions?: [string, string][];
    onAction?: (nid: number, actionId: string) => void;
    onClose?: (nid: number, reason: number, detail: string) => void;
  },
): number {
  const id = nextId++;
  const item: NotificationItem = {
    id,
    type,
    title,
    message,
    icon: options?.icon,
    timeout: options?.timeout,
    actions: options?.actions,
    onAction: options?.onAction,
    onClose: options?.onClose,
  };

  setNotifications((prev) => [item, ...prev]);

  if (item.timeout && item.timeout > 0) {
    const timer = setTimeout(() => {
      const n = notifications().find((x) => x.id === id);
      if (n) {
        removeNotification(id);
        n.onClose?.(id, 1, "timeout");
      }
      timers.delete(id);
    }, item.timeout * 1000);
    timers.set(id, timer);
  }

  return id;
}

export function removeNotification(id: number): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  setNotifications((prev) => prev.filter((n) => n.id !== id));
}

export function closeNotification(id: number, reason = 2, detail = "user dismiss"): void {
  const n = notifications().find((x) => x.id === id);
  if (n) {
    removeNotification(id);
    n.onClose?.(id, reason, detail);
  }
}

export function clearAllNotifications(): void {
  for (const id of notifications().map((n) => n.id)) {
    removeNotification(id);
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const notificationsStore = {
  get notifications() {
    return notifications();
  },
  addNotification,
  removeNotification,
  closeNotification,
  clearAllNotifications,
};
