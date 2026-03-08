/*
 * Author: Ali Parnan
 *
 * Virtual keyboard — On-screen keyboard using simple-keyboard.
 * Phase 6b-3.
 */

import type { Component } from "solid-js";
import { createEffect, Show } from "solid-js";
import { virtualKeyboardVisible } from "@/store";
import SimpleKeyboard from "simple-keyboard";
import "simple-keyboard/build/css/index.css";
import "./VirtualKeyboard.css";

export interface VirtualKeyboardProps {
  onKeyPress?: (button: string) => void;
}

export const VirtualKeyboard: Component<VirtualKeyboardProps> = (props) => {
  let containerEl: HTMLDivElement | undefined;
  let keyboard: SimpleKeyboard | null = null;

  createEffect(() => {
    const visible = virtualKeyboardVisible();
    if (!visible || !containerEl) return;

    keyboard = new SimpleKeyboard(containerEl, {
      onChange: () => {},
      onKeyPress: (button) => {
        props.onKeyPress?.(button);
      },
      theme: "hg-theme-default hg-layout-numeric hg-theme-ios",
      physicalKeyboardHighlight: true,
      stopMouseDownPropagation: true,
    });

    return () => {
      if (keyboard) {
        keyboard.destroy();
        keyboard = null;
      }
    };
  });

  return (
    <Show when={virtualKeyboardVisible()} fallback={null}>
      <div class="virtual-keyboard-wrapper">
        <div ref={(el) => { containerEl = el; }} class="simple-keyboard" />
      </div>
    </Show>
  );
};
