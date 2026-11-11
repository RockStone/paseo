import { openExternalUrl } from "@getpaseo/plugin/client";
import { createContext, useCallback, useContext, useMemo } from "react";
import { Text, type TextStyle } from "react-native";
import { splitLinksAndPaths, type TextSegment } from "../shared/format";

/**
 * What the drawer can open. The host's navigation opens links and workspace files in the side pane
 * beside the session; without it (older hosts, web links off the desktop app) links go to the
 * default browser and paths stay text.
 */
export interface Openers {
  openUrl(url: string): void;
  openPath?: (path: string, line?: number) => void;
}

export interface HostNavigation {
  openBrowser?: (input: { url: string; workspaceId: string }) => void;
  openFile?: (input: { path: string; workspaceId: string; lineStart?: number }) => void;
}

function openInBrowser(url: string) {
  void openExternalUrl(url).catch((error: unknown) => {
    console.warn("[driveboard] Could not open link", error);
  });
}

const OpenersContext = createContext<Openers>({ openUrl: openInBrowser });

export const OpenersProvider = OpenersContext.Provider;

export function createOpeners(
  navigation: HostNavigation | undefined,
  workspaceId: string,
): Openers {
  const { openBrowser, openFile } = navigation ?? {};
  return {
    openUrl: (url) => {
      if (!openBrowser) return openInBrowser(url);
      try {
        openBrowser({ url, workspaceId });
      } catch {
        openInBrowser(url);
      }
    },
    openPath: openFile
      ? (path, line) => openFile({ path, workspaceId, ...(line ? { lineStart: line } : {}) })
      : undefined,
  };
}

export function Link({ url, label, style }: { url: string; label: string; style: TextStyle }) {
  const { openUrl } = useContext(OpenersContext);
  const onPress = useCallback(() => openUrl(url), [openUrl, url]);
  return (
    <Text
      style={style}
      numberOfLines={label === url ? undefined : 1}
      accessibilityRole="link"
      onPress={onPress}
    >
      {label}
    </Text>
  );
}

function PathLink({
  segment,
  style,
}: {
  segment: Extract<TextSegment, { kind: "path" }>;
  style: TextStyle;
}) {
  const { openPath } = useContext(OpenersContext);
  const { path, line } = segment;
  const onPress = useCallback(() => openPath?.(path, line), [openPath, path, line]);
  if (!openPath) return <Text>{segment.text}</Text>;
  return (
    <Text
      style={style}
      accessibilityRole="link"
      accessibilityHint="Opens beside the session"
      onPress={onPress}
    >
      {segment.text}
    </Text>
  );
}

/** Text with its links and workspace file paths tappable. */
export function Segments({
  text,
  style,
  linkStyle,
  pathStyle,
  selectable,
}: {
  text: string;
  style?: TextStyle;
  linkStyle: TextStyle;
  pathStyle: TextStyle;
  selectable?: boolean;
}) {
  const segments = useMemo(() => splitLinksAndPaths(text), [text]);
  return (
    <Text style={style} selectable={selectable}>
      {segments.map((segment) => {
        if (segment.kind === "link") {
          return (
            <Link key={segment.start} url={segment.url} label={segment.text} style={linkStyle} />
          );
        }
        if (segment.kind === "path") {
          return <PathLink key={segment.start} segment={segment} style={pathStyle} />;
        }
        return <Text key={segment.start}>{segment.text}</Text>;
      })}
    </Text>
  );
}
