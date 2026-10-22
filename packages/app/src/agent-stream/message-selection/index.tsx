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
import { ActivityIndicator, View } from "react-native";
import { Check, Copy, ListChecks, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Alert } from "@/components/ui/alert";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { openMessageSelection, type MessageSelectionModel, type SelectableMessage } from "./model";

const Context = createContext<MessageSelectionModel | null>(null);
const CopyIcon = withUnistyles(Copy);
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

export function MessageSelectionToolbar({ target }: { target: string | null }) {
  const model = useMessageSelection();
  const state = useSyncExternalStore(model?.subscribe ?? noopSubscribe, () => model?.getState());
  const { t } = useTranslation();
  const toast = useToast();
  const compact = useIsCompactFormFactor();
  const size = paneContentToolbarIconSize(compact);
  // Changing the focused conversation never carries its selection into another tab.
  useEffect(() => () => model?.cancel(), [model, target]);
  const start = useCallback(() => {
    if (target) model?.start(target);
  }, [model, target]);
  const cancel = useCallback(() => model?.cancel(), [model]);
  const copy = useCallback(async () => {
    const copied = await model?.copy((text) =>
      writeMarkdownToRichClipboard(text, getDefaultMarkdownClipboardEnvironment()),
    );
    if (copied) toast.show(t("message.selection.copied"), { variant: "success" });
  }, [model, toast, t]);
  if (!target || !model || !state) return null;
  if (state.target !== target)
    return (
      <ToolbarButton
        label={t("message.selection.start")}
        onPress={start}
        testID="message-selection-start"
      >
        <ListIcon size={size} uniProps={iconColor} />
      </ToolbarButton>
    );
  return (
    <View style={styles.controls}>
      <ToolbarButton
        label={t("message.selection.copy", { count: state.selected.size })}
        disabled={state.pending || state.selected.size === 0}
        onPress={copy}
        testID="message-selection-copy"
      >
        {state.pending ? (
          <ActivityIndicator size="small" />
        ) : (
          <CopyIcon size={size} uniProps={iconColor} />
        )}
      </ToolbarButton>
      <ToolbarButton label={t("common.cancel")} onPress={cancel} testID="message-selection-cancel">
        <CancelIcon size={size} uniProps={iconColor} />
      </ToolbarButton>
    </View>
  );
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
          style={styles.checkboxHitbox}
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
