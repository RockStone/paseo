import React, { createRef, type RefCallback } from "react";
import { flushSync, createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverlayRegistration } from "@/keyboard";
import { useGlobalOverlayLayer } from "@/lib/overlay-root";
import { EdgeDrawerLayer } from "./edge-drawer-layer.web";

// A stand-in for the lightbox: a registered modal whose DOM sits outside the overlay root.
function Modal({ container }: { container: HTMLElement }) {
  const layer = useGlobalOverlayLayer("modal", true);
  const setScope = useOverlayRegistration({
    keys: ["Escape"],
    active: true,
    layer,
    onKeyDown: () => false,
  });
  return createPortal(
    <div data-testid="modal" ref={setScope as RefCallback<HTMLDivElement>} />,
    container,
  );
}

function Harness({
  onClose,
  modal,
  triggerRef,
}: {
  onClose: () => void;
  modal: HTMLElement | null;
  triggerRef: React.RefObject<View | null>;
}) {
  return (
    <>
      <EdgeDrawerLayer active onClose={onClose} triggerRef={triggerRef}>
        <span>drawer</span>
      </EdgeDrawerLayer>
      {modal ? <Modal container={modal} /> : null}
    </>
  );
}

describe("EdgeDrawerLayer outside presses", () => {
  let root: Root;
  let host: HTMLDivElement;
  let outside: HTMLButtonElement;
  let modalHost: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    outside = document.createElement("button");
    modalHost = document.createElement("div");
    document.body.append(host, outside, modalHost);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    document.getElementById("overlay-root")?.remove();
    document.body.replaceChildren();
  });

  const press = (target: Element) =>
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  it("closes on a press outside, but not on a press in a modal opened from it", () => {
    const onClose = vi.fn();
    const triggerRef = createRef<View>();
    flushSync(() =>
      root.render(<Harness onClose={onClose} modal={null} triggerRef={triggerRef} />),
    );
    flushSync(() =>
      root.render(<Harness onClose={onClose} modal={modalHost} triggerRef={triggerRef} />),
    );
    press(modalHost.querySelector('[data-testid="modal"]')!);
    expect(onClose).not.toHaveBeenCalled();

    flushSync(() =>
      root.render(<Harness onClose={onClose} modal={null} triggerRef={triggerRef} />),
    );
    press(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
