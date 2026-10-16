import {
  useCallback,
  useContext,
  useEffect,
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
import { createAssistantSelectionClipboardContent } from "./content.web";
import { SelectionReplyContext } from "./reply";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface SelectionReply {
  text: string;
  left: number;
  top: number;
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
        setReply(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const contained =
        surface.contains(range.startContainer) && surface.contains(range.endContainer);
      const content = contained ? createAssistantSelectionClipboardContent(selection) : null;
      const rect = range.getBoundingClientRect();
      if (!content || rect.width <= 0 || rect.height <= 0) {
        setReply(null);
        return;
      }
      // Adapted from crpboy's PR #3421: anchor the action to the selected range,
      // clamp it to the viewport, and preserve Markdown in the reply context.
      setReply({
        text: content.plainText,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 100)),
        top: Math.max(8, rect.top - 40),
      });
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
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("selectionchange", readSelection);
      document.removeEventListener("pointerup", readSelection);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", dismiss, true);
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
    () => ({
      position: "fixed",
      left: reply?.left,
      top: reply?.top,
      zIndex: layer,
      pointerEvents: "auto",
    }),
    [reply, layer],
  );

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
