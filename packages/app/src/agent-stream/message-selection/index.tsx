import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { Check, ListChecks, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Alert } from "@/components/ui/alert";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { openMessageSelection, type MessageSelectionModel, type SelectableMessage } from "./model";

const Context = createContext<MessageSelectionModel | null>(null);
// The conversation a stream renders, so footer buttons know which selection to start.
const TargetContext = createContext<string | null>(null);
export const MessageSelectionTargetProvider = TargetContext.Provider;
const CancelIcon = withUnistyles(X);
const ListIcon = withUnistyles(ListChecks);
const CheckIcon = withUnistyles(Check);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const checkColor = (theme: Theme) => ({ color: theme.colors.accentForeground });
const noopSubscribe = () => () => {};
export function MessageSelectionProvider({ children }: { children: ReactNode }) {
  const [model] = useState(openMessageSelection);
  return <Context.Provider value={model}>{children}</Context.Provider>;
}
export function useMessageSelection() {
  return useContext(Context);
}
export function useMessageSelectionActive(target: string) {
  const model = useMessageSelection();
  return useSyncExternalStore(
    model?.subscribe ?? noopSubscribe,
    () => model?.getState().target === target,
  );
}

/** Ends a selection when the focused conversation changes, so it never carries into another tab. */
export function useEndMessageSelectionOnSwitch(target: string | null) {
  const model = useMessageSelection();
  useEffect(() => () => model?.cancel(), [model, target]);
}

/**
 * Paseoi: while this conversation is selecting, a response footer's Copy copies the selected
 * messages; null otherwise, and the footer copies its own response.
 */
export function useMessageSelectionCopy() {
  const model = useMessageSelection();
  const target = useContext(TargetContext);
  const count = useSyncExternalStore(model?.subscribe ?? noopSubscribe, () => {
    const state = model?.getState();
    return state && state.target === target ? state.selected.size : -1;
  });
  const toast = useToast();
  const { t } = useTranslation();
  const copy = useCallback(async () => {
    const copied =
      (await model?.copy((text) =>
        writeMarkdownToRichClipboard(text, getDefaultMarkdownClipboardEnvironment()),
      )) ?? false;
    if (copied) toast.show(t("message.selection.copied"), { variant: "success" });
    return copied;
  }, [model, toast, t]);
  return useMemo(() => (count < 0 ? null : { count, copy }), [count, copy]);
}

/** Starts selecting messages in this conversation with `item` checked. */
export function SelectMessageButton({ item }: { item: SelectableMessage }) {
  const model = useMessageSelection();
  const target = useContext(TargetContext);
  const active = useSyncExternalStore(
    model?.subscribe ?? noopSubscribe,
    () => model?.getState().target === target,
  );
  const { t } = useTranslation();
  const start = useCallback(() => {
    if (target) model?.start(target, item);
  }, [model, target, item]);
  const cancel = useCallback(() => model?.cancel(), [model]);
  if (!model || !target) return null;
  // While selecting, the same spot cancels the selection.
  if (active)
    return (
      <ToolbarButton
        label={t("common.cancel")}
        onPress={cancel}
        testID="message-selection-cancel"
        compact
      >
        <CancelIcon size={ICON_SIZE.sm} uniProps={iconColor} />
      </ToolbarButton>
    );
  return (
    <ToolbarButton
      label={t("message.selection.start")}
      onPress={start}
      testID="message-selection-start"
      compact
    >
      <ListIcon size={ICON_SIZE.sm} uniProps={iconColor} />
    </ToolbarButton>
  );
}

/** Starts selecting messages in a conversation with none checked, for menus. */
export function useStartMessageSelection(target: string | null) {
  const model = useMessageSelection();
  return useMemo(() => (target && model ? () => model.start(target) : null), [model, target]);
}

export function MessageSelectionRow({
  target,
  item,
  children,
}: {
  target: string;
  item: SelectableMessage;
  children: ReactNode;
}) {
  const model = useMessageSelection();
  const mode = useSyncExternalStore(model?.subscribe ?? noopSubscribe, () => {
    const state = model?.getState();
    if (state?.target !== target) return "hidden";
    return `${state.pending ? "pending" : "ready"}:${state.selected.has(item.id) ? "checked" : "unchecked"}`;
  });
  const checked = mode.endsWith(":checked");
  const disabled = mode.startsWith("pending:");
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const toggle = useCallback(() => model?.toggle(target, item), [model, target, item]);
  const { t } = useTranslation();
  // Paseoi: wide layouts float the checkbox in the margin left of the message, so selecting
  // never reflows the conversation. Compact layouts have no margin and keep the gutter.
  const floating = !useIsCompactFormFactor();
  if (!model) return children;
  // Keep the message subtree mounted when the selection gutter appears, including
  // expanded summaries, code blocks, images, and their measurement state.
  return (
    <View style={styles.row}>
      {mode !== "hidden" ? (
        <PressHighlight
          onPress={toggle}
          disabled={disabled}
          accessibilityRole="checkbox"
          aria-checked={checked}
          accessibilityLabel={t(
            item.kind === "user_message" ? "message.selection.user" : "message.selection.assistant",
          )}
          accessibilityState={accessibilityState}
          testID={`message-select-${item.id}`}
          style={floating ? styles.checkboxFloating : styles.checkboxHitbox}
          highlightStyle={styles.checkboxHover}
        >
          <View style={[styles.checkbox, checked && styles.checked]}>
            {checked ? <CheckIcon size={14} uniProps={checkColor} /> : null}
          </View>
        </PressHighlight>
      ) : null}
      <View key="message" style={styles.message}>
        {children}
      </View>
    </View>
  );
}

export function MessageSelectionError({ target }: { target: string }) {
  const model = useMessageSelection();
  const failed = useSyncExternalStore(
    model?.subscribe ?? noopSubscribe,
    () => model?.getState().target === target && model.getState().error,
  );
  const { t } = useTranslation();
  return failed ? (
    <Alert
      variant="error"
      title={t("message.selection.failed")}
      description={t("message.selection.retry")}
      testID="message-selection-error"
    />
  ) : null;
}
const styles = StyleSheet.create((theme) => ({
  controls: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  row: { flexDirection: "row", alignItems: "flex-start" },
  checkboxHitbox: {
    width: 32,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    transform: [
      { translateX: -theme.spacing[2] - theme.spacing[0.5] },
      { translateY: theme.spacing[1] },
    ],
  },
  checkboxFloating: {
    position: "absolute",
    top: theme.spacing[1],
    left: -32 - theme.spacing[2],
    width: 32,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  checkboxHover: { backgroundColor: theme.colors.interactionHighlight },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  message: { flex: 1, minWidth: 0 },
}));
