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
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { writeRichClipboardContent, type MarkdownClipboardContent } from "@/utils/rich-clipboard";
import { getOverlayRoot, useOverlayLayer, useWebOverlayRegistration } from "@/lib/overlay-root";
import { useRetainedPanelActive } from "@/components/retained-panel";
import {
  createAssistantSelectionClipboardContent,
  createTranscriptSelectionClipboardContent,
} from "./content.web";
import { SelectionReplyContext } from "./reply";
import { selectionReplyAnchor, type SelectionReplyAnchor } from "./position.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  selectionReplyEnabled?: boolean;
}

interface SelectionReply {
  content: MarkdownClipboardContent;
  anchor: SelectionReplyAnchor;
  copying: boolean;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

export function AssistantSelectionCopySurface({
  children,
  style,
  selectionReplyEnabled = true,
}: AssistantSelectionCopySurfaceProps) {
  const onReply = useContext(SelectionReplyContext);
  const active = useRetainedPanelActive();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<SelectionReply | null>(null);
  const copyInFlight = useRef(false);
  const selectionRevision = useRef(0);
  const selectionEndpoints = useRef<{
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
  } | null>(null);
  const layer = useOverlayLayer("floating");
  const { t } = useTranslation();
  const toast = useToast();
  const dismiss = useCallback(() => {
    selectionRevision.current += 1;
    selectionEndpoints.current = null;
    setReply(null);
  }, []);

  useEffect(() => {
    if (!onReply || !active || !selectionReplyEnabled) return;
    function readSelection() {
      const selection = window.getSelection();
      const surface = surfaceRef.current;
      if (!selection || !surface || selection.rangeCount !== 1 || selection.isCollapsed) {
        return;
      }
      const content = createTranscriptSelectionClipboardContent(selection, surface);
      const anchor = selectionReplyAnchor(selection);
      if (!content || !anchor) return;
      const endpoints = selectionEndpoints.current;
      if (
        endpoints?.anchorNode !== selection.anchorNode ||
        endpoints.anchorOffset !== selection.anchorOffset ||
        endpoints.focusNode !== selection.focusNode ||
        endpoints.focusOffset !== selection.focusOffset
      ) {
        selectionRevision.current += 1;
        selectionEndpoints.current = {
          anchorNode: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focusNode: selection.focusNode,
          focusOffset: selection.focusOffset,
        };
      }
      setReply({ content, anchor, copying: copyInFlight.current });
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
  }, [onReply, active, selectionReplyEnabled, dismiss]);

  const overlay = useWebOverlayRegistration({
    active: reply !== null && active && selectionReplyEnabled && onReply !== null,
    layer,
    manageFocus: false,
    onKeyDown: (event) => {
      if (event.key !== "Escape") return false;
      dismiss();
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
    if (!reply || !onReply || copyInFlight.current) return;
    onReply(reply.content.plainText);
    window.getSelection()?.removeAllRanges();
    dismiss();
  }, [reply, onReply, dismiss]);
  const copySelection = useCallback(async () => {
    if (!reply || copyInFlight.current) return;
    copyInFlight.current = true;
    const revision = selectionRevision.current;
    setReply({ ...reply, copying: true });
    try {
      await writeRichClipboardContent(reply.content, getDefaultMarkdownClipboardEnvironment());
      // A pending clipboard write must not dismiss a newer selection.
      if (selectionRevision.current === revision) {
        window.getSelection()?.removeAllRanges();
        dismiss();
      }
    } catch {
      toast.error(t("common.errors.unableToCopy"));
    } finally {
      copyInFlight.current = false;
      setReply((current) => (current ? { ...current, copying: false } : null));
    }
  }, [reply, toast, t, dismiss]);
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
  }, [reply, active, onReply, selectionReplyEnabled]);

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
      {reply && active && selectionReplyEnabled && onReply
        ? createPortal(
            <div
              ref={setActionScope}
              style={actionStyle}
              onPointerDown={preserveSelection}
              data-testid="selection-actions"
            >
              <View style={styles.toolbar}>
                <Button
                  testID="reply-to-selection"
                  size="sm"
                  variant="ghost"
                  onPress={submitReply}
                  disabled={reply.copying}
                  textStyle={styles.actionText}
                >
                  {t("common.reply", { defaultValue: "Reply" })}
                </Button>
                <View style={styles.divider} testID="selection-actions-divider" />
                <Button
                  testID="copy-selection"
                  size="sm"
                  variant="ghost"
                  onPress={copySelection}
                  loading={reply.copying}
                  loadingMode="replace"
                  accessibilityLabel={t("common.actions.copy")}
                  textStyle={styles.actionText}
                >
                  {t("common.actions.copy")}
                </Button>
              </View>
            </div>,
            getOverlayRoot(),
          )
        : null}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.lg,
  },
  divider: {
    width: theme.borderWidth[1],
    height: theme.spacing[4],
    backgroundColor: theme.colors.foregroundMuted,
    opacity: theme.opacity[50],
  },
  actionText: { color: theme.colors.foreground },
}));
