import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import type { DaemonClient, FileUploadInput } from "@getpaseo/client/internal/daemon-client";
import type { UserComposerAttachment } from "@/attachments/types";
import type { Theme } from "@/styles/theme";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useSessionStore } from "@/stores/session-store";
import { useComposerKeyboardScope } from "../keyboard-scope";
import { createTextFilePaste } from "./paste-text";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface PasteTextAsFileActionProps {
  serverId: string;
  client: DaemonClient | null;
  connected: boolean;
  enabled: boolean;
  blocked: boolean;
  addFiles(files: Extract<UserComposerAttachment, { kind: "file" }>[]): void;
  focusInput(): void;
  onPendingChange(pending: boolean): void;
}

export function PasteTextAsFileAction(props: PasteTextAsFileActionProps) {
  const { t } = useTranslation();
  const handlerId = useId();
  const { isActiveComposer } = useComposerKeyboardScope();
  const supported = useSessionStore(
    (state) => state.sessions[props.serverId]?.serverInfo?.features?.temporaryFileUploads === true,
  );
  const current = useRef({ props, supported, isActiveComposer, t });
  current.current = { props, supported, isActiveComposer, t };
  const paste = useMemo(() => {
    function uploadClient() {
      const latest = current.current;
      if (!latest.props.connected || !latest.props.client)
        throw new Error(latest.t("composer.pasteText.disconnected"));
      // COMPAT(temporaryFileUploads): added in v0.12.0-paseoi.87, remove after 2027-04-22 once the host floor includes it.
      if (!latest.supported) throw new Error(latest.t("composer.pasteText.updateHost"));
      return latest.props.client;
    }
    async function capture(): Promise<FileUploadInput> {
      uploadClient();
      const text = await Clipboard.getStringAsync();
      const translate = current.current.t;
      if (!text.length) throw new Error(translate("composer.pasteText.empty"));
      const bytes = new TextEncoder().encode(text);
      const fileName = `paste-${randomUUID()}.txt`;
      if (bytes.byteLength > 50 * 1024 * 1024) {
        throw new Error(translate("composer.errors.fileTooLarge", { size: "50MB", fileName }));
      }
      return { fileName, mimeType: "text/plain", bytes, temporary: true };
    }
    return createTextFilePaste({
      capture,
      upload: (file) => uploadClient().uploadFile(file),
      attach(file) {
        current.current.props.addFiles([file]);
        if (current.current.isActiveComposer) current.current.props.focusInput();
      },
      pendingChanged: (pending) => current.current.props.onPendingChange(pending),
    });
  }, []);
  const state = useSyncExternalStore(paste.subscribe, paste.getState, paste.getState);
  useEffect(() => () => paste.cancel(), [paste]);
  useKeyboardActionHandler({
    handlerId,
    actions: ["message-input.paste-as-file"],
    enabled: props.enabled,
    priority: 20,
    isActive: () => isActiveComposer,
    handle: () => {
      if (!props.blocked && state.status !== "error") void paste.run();
      return true;
    },
  });
  if (state.status === "idle") return null;
  if (state.status === "pending") {
    return (
      <View style={styles.pending} testID="paste-text-pending">
        <ThemedLoadingSpinner size="small" uniProps={spinnerColor} />
        <Text style={styles.text}>{t("composer.pasteText.pending")}</Text>
      </View>
    );
  }
  return (
    <Alert
      variant="error"
      size="sm"
      title={t("composer.pasteText.failed")}
      description={state.message}
      testID="paste-text-error"
    >
      <Button size="sm" variant="ghost" onPress={paste.run} disabled={props.blocked}>
        {t("common.actions.retry")}
      </Button>
      <Button size="sm" variant="ghost" onPress={paste.cancel}>
        {t("common.actions.cancel")}
      </Button>
    </Alert>
  );
}

const styles = StyleSheet.create((theme) => ({
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
