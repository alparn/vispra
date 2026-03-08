/*
 * Author: Ali Parnan
 *
 * Login overlay — Password prompt when server requires authentication.
 * Phase 6b-3.
 */

import type { Component } from "solid-js";
import { createSignal, onMount, Show } from "solid-js";
import "./LoginOverlay.css";

export interface LoginOverlayProps {
  visible: boolean;
  heading: string;
  onConnect: (password: string) => void;
  onCancel: () => void;
}

export const LoginOverlay: Component<LoginOverlayProps> = (props) => {
  const [password, setPassword] = createSignal("");
  let passwordInputRef: HTMLInputElement | undefined;

  const handleConnect = () => {
    props.onConnect(password());
    setPassword("");
  };

  const handleCancel = () => {
    setPassword("");
    props.onCancel();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConnect();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  onMount(() => {
    if (props.visible && passwordInputRef) {
      passwordInputRef.focus();
    }
  });

  return (
    <Show when={props.visible} fallback={null}>
      <div
        class="login-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-header"
      >
        <div class="login-box" onClick={(e) => e.stopPropagation()}>
          <form
            id="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleConnect();
            }}
          >
            <div class="login-innerbox">
              <span id="login-header" class="login-header">
                {props.heading}
              </span>
              <div class="password-box">
                <input
                  ref={passwordInputRef}
                  type="password"
                  title="Password"
                  autocomplete="current-password"
                  placeholder="Password"
                  maxlength={256}
                  tabindex={1}
                  required
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div class="login-buttons">
                <button
                  type="button"
                  class="login-button login-button-cancel"
                  tabindex={2}
                  onClick={handleCancel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="login-button login-button-connect"
                  tabindex={3}
                >
                  Connect
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
