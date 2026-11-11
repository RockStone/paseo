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
import { ActivityIndicator, View, type GestureResponderEvent } from "react-native";
import { Check, Copy, ListChecks, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { formatShortcut } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { useToast } from "@/contexts/toast-context";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Alert } from "@/components/ui/alert";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { openMessageSelection, type MessageSelectionModel, type SelectableMessage } from "./model";

const Context = createContext<MessageSelectionModel | null>(null);
interface CopyScope {
  target: string;
  /** One user message, or every assistant message in a response. */
  read: () => readonly SelectableMessage[];
}
/** What a message's Copy button selects. */
const CopyScopeContext = createContext<CopyScope | null>(null);
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

export function SelectableMessages({
  target,
  read,
  children,
}: CopyScope & { children: ReactNode }) {
  const scope = useMemo(() => ({ target, read }), [target, read]);
  return <CopyScopeContext.Provider value={scope}>{children}</CopyScopeContext.Provider>;
}

/** Native has no modifier key; there selection starts from the header button. */
function hasSelectModifier(event: GestureResponderEvent): boolean {
  if (isNative) return false;
  const { nativeEvent } = event;
  if (getShortcutOs() === "mac") return "metaKey" in nativeEvent && nativeEvent.metaKey === true;
  return "ctrlKey" in nativeEvent && nativeEvent.ctrlKey === true;
}

export interface MessageCopyGesture {
  /** While selecting, the Copy button adds or removes its messages instead of copying. */
  isSelecting: boolean;
  /** How the button's label mentions the modifier, or null where there is none. */
  hint: string | null;
  /** True when the press belonged to selection, so the caller must not copy. */
  press: (event: GestureResponderEvent) => boolean;
}

/**
 * A modifier-click on a message's Copy button starts selection with that message
 * checked; while selecting, any click on it toggles. A plain click copies as before.
 */
export function useMessageCopyGesture(action: string): MessageCopyGesture | null {
  const model = useMessageSelection();
  const scope = useContext(CopyScopeContext);
  const { t } = useTranslation();
  const isSelecting = useSyncExternalStore(
    model?.subscribe ?? noopSubscribe,
    () => scope !== null && model?.getState().target === scope.target,
  );
  const press = useCallback(
    (event: GestureResponderEvent) => {
      if (!model || !scope) return false;
      if (model.getState().target !== scope.target) {
        if (!hasSelectModifier(event)) return false;
        model.start(scope.target);
      }
      model.toggle(scope.target, scope.read());
      return true;
    },
    [model, scope],
  );
  const hint = isNative
    ? null
    : t("message.selection.copyHint", { action, key: formatShortcut(["mod"], getShortcutOs()) });
  return useMemo(
    () => (model && scope ? { isSelecting, hint, press } : null),
    [model, scope, isSelecting, hint, press],
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
  if (state.target !== target) {
    // Desktop and web start selection with a modifier-click on a message's Copy button.
    // Touch layouts have no modifier, so they keep this button.
    if (!isNative && !compact) return null;
    return (
      <ToolbarButton
        label={t("message.selection.start")}
        onPress={start}
        testID="message-selection-start"
      >
        <ListIcon size={size} uniProps={iconColor} />
      </ToolbarButton>
    );
  }
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
  const readMessages = useCallback(() => [item], [item]);
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
        <SelectableMessages target={target} read={readMessages}>
          {children}
        </SelectableMessages>
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
