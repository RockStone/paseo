import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useFileUrl, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import type { Theme } from "@/styles/theme";
import { FilePanelLoading } from "../loading";
import { FileMediaPreview } from "./view";
import type { FileMediaPreviewProps } from "./types";

type Props = PluginFilePanelProps & { kind: FileMediaPreviewProps["kind"] };
const mediaAppearance = (theme: Theme) => ({ colorScheme: theme.colorScheme });
const ThemedMediaPreview = withUnistyles(FileMediaPreview, mediaAppearance);

export function MediaFilePanel({ file, kind }: Props) {
  const active = useRetainedPanelActive();
  const visible = useAppVisible();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // Retained tabs stay mounted. Unmount playback when hidden so it cannot keep playing.
  return (
    <View style={styles.container}>
      {active && visible ? (
        <MediaSource key={attempt} file={file} kind={kind} retry={retry} />
      ) : null}
    </View>
  );
}

function MediaSource({ file, kind, retry }: Pick<Props, "file" | "kind"> & { retry(): void }) {
  const source = useFileUrl(file);
  if (source.status === "loading") return <FilePanelLoading />;
  if (source.status === "error") return <MediaError message={source.error.message} retry={retry} />;
  return (
    <MediaPlayback key={source.url} url={source.url} kind={kind} name={file.name} retry={retry} />
  );
}

function MediaPlayback({
  url,
  kind,
  name,
  retry,
}: Pick<FileMediaPreviewProps, "url" | "kind"> & {
  name: string;
  retry(): void;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const loaded = useCallback(() => setReady(true), []);
  const fail = useCallback(() => setFailed(true), []);
  if (failed) return <MediaError message={t("panels.file.mediaPlaybackFailed")} retry={retry} />;
  return (
    <View style={styles.player}>
      <ThemedMediaPreview
        url={url}
        kind={kind}
        label={t(kind === "video" ? "panels.file.videoPreview" : "panels.file.audioPreview", {
          name,
        })}
        onReady={loaded}
        onError={fail}
      />
      {ready ? null : <FilePanelLoading />}
    </View>
  );
}

function MediaError({ message, retry }: { message: string; retry(): void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.error} testID="file-media-error">
      <Text style={styles.errorText} accessibilityRole="alert">
        {message}
      </Text>
      <Button variant="outline" size="sm" onPress={retry}>
        {t("common.actions.retry")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  player: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  error: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
