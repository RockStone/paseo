import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getOverlayRoot, useOverlayLayer, useWebOverlayRegistration } from "@/lib/overlay-root";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { createAssistantSelectionClipboardContent, createSelectionReplyText } from "./content.web";
import { SelectionReplyContext } from "./reply";
import { selectionReplyAnchor, type SelectionReplyAnchor } from "./position.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface SelectionReply {
  text: string;
  anchor: SelectionReplyAnchor;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

export function AssistantSelectionCopySurface({
  children,
  style,
}: AssistantSelectionCopySurfaceProps) {
  const onReply = useContext(SelectionReplyContext);
  const active = useRetainedPanelActive();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<SelectionReply | null>(null);
  const layer = useOverlayLayer("floating");
  const { t } = useTranslation();

  useEffect(() => {
    if (!onReply || !active) return;
    function readSelection() {
      const selection = window.getSelection();
      const surface = surfaceRef.current;
      if (!selection || !surface || selection.rangeCount !== 1 || selection.isCollapsed) {
        return;
      }
      const text = createSelectionReplyText(selection, surface);
      const anchor = selectionReplyAnchor(selection);
      if (!text || !anchor) return;
      setReply({ text, anchor });
    }
    function dismiss() {
      setReply(null);
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && actionRef.current?.contains(event.target)) return;
      dismiss();
    }
    document.addEventListener("selectionchange", readSelection);
    document.addEventListener("pointerup", readSelection);
    document.addEventListener("pointerdown", onPointerDown, true);
    // Layout-driven scrolling and DOM replacement must not erase a captured excerpt.
    window.addEventListener("scroll", readSelection, true);
    window.addEventListener("wheel", dismiss, { capture: true, passive: true });
    window.addEventListener("touchmove", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("selectionchange", readSelection);
      document.removeEventListener("pointerup", readSelection);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", readSelection, true);
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("touchmove", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [onReply, active]);

  const overlay = useWebOverlayRegistration({
    active: reply !== null && active && onReply !== null,
    layer,
    manageFocus: false,
    onKeyDown: (event) => {
      if (event.key !== "Escape") return false;
      setReply(null);
      event.preventDefault();
      return true;
    },
  });

  const setActionScope = useCallback(
    (node: HTMLDivElement | null) => {
      actionRef.current = node;
      overlay(node);
    },
    [overlay],
  );
  const preserveSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => event.preventDefault(),
    [],
  );
  const submitReply = useCallback(() => {
    if (!reply || !onReply) return;
    onReply(reply.text);
    window.getSelection()?.removeAllRanges();
    setReply(null);
  }, [reply, onReply]);
  const actionStyle = useMemo<CSSProperties>(
    () => ({ position: "fixed", zIndex: layer, pointerEvents: "auto", visibility: "hidden" }),
    [layer],
  );
  useLayoutEffect(() => {
    const action = actionRef.current;
    if (!action || !reply) return;
    const { anchor } = reply;
    const placeAction = () => {
      const { width, height } = action.getBoundingClientRect();
      const gutter = 8;
      const maximumLeft = Math.max(gutter, window.innerWidth - width - gutter);
      const left = Math.max(gutter, Math.min(anchor.x - width / 2, maximumLeft));
      const above = anchor.top - height - gutter;
      const preferredTop = above >= gutter ? above : anchor.bottom + gutter;
      const maximumTop = Math.max(gutter, window.innerHeight - height - gutter);
      const top = Math.max(gutter, Math.min(preferredTop, maximumTop));
      Object.assign(action.style, { left: `${left}px`, top: `${top}px`, visibility: "visible" });
    };
    placeAction();
    const observer = new ResizeObserver(placeAction);
    observer.observe(action);
    return () => observer.disconnect();
  }, [reply, active, onReply]);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  return (
    <div ref={surfaceRef} onCopy={handleCopy} style={DISPLAY_CONTENTS}>
      <View style={style}>{children}</View>
      {reply && active && onReply
        ? createPortal(
            <div ref={setActionScope} style={actionStyle} onPointerDown={preserveSelection}>
              <Button
                testID="reply-to-selection"
                size="sm"
                variant="secondary"
                onPress={submitReply}
              >
                {t("common.reply", { defaultValue: "Reply" })}
              </Button>
            </div>,
            getOverlayRoot(),
          )
        : null}
    </div>
  );
}
