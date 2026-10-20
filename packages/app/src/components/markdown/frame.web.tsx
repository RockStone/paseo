import React, { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react-native";
import { markdownTableSources } from "./source";
import { Button } from "@/components/ui/button";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";

interface TableControl {
  table: HTMLTableElement;
  host: HTMLDivElement;
}

export function MarkdownRendererFrame({
  children,
  watchTables,
  markdownSource = "",
}: {
  children: ReactElement;
  watchTables?: boolean;
  markdownSource?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [controls, setControls] = useState<TableControl[]>([]);
  useEffect(() => {
    const root = frame.current;
    if (!root || !watchTables) {
      setControls([]);
      return;
    }
    const mounted = new Map<HTMLTableElement, HTMLDivElement>();
    const scan = () => {
      let changed = false;
      for (const [table, host] of mounted) {
        if (!root.contains(table) || host.parentElement !== table.parentElement) {
          host.remove();
          mounted.delete(table);
          changed = true;
        }
      }
      for (const table of root.querySelectorAll("table")) {
        if (mounted.has(table)) continue;
        // The engine owns the table. Add a sibling toolbar without changing its rows or selection.
        const host = document.createElement("div");
        host.className = "paseo-table-tools";
        host.dataset.paseoMarkdownIgnore = "true";
        table.parentElement?.classList.add("paseo-table-wrapper");
        table.before(host);
        mounted.set(table, host);
        changed = true;
      }
      if (changed)
        setControls(
          [...root.querySelectorAll("table")].map((table) => ({
            table,
            host: mounted.get(table)!,
          })),
        );
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const host of mounted.values()) host.remove();
    };
  }, [watchTables]);
  return (
    <div ref={frame} className="paseo-markdown-frame">
      <style data-paseo-markdown-ignore="true">{`
        .paseo-markdown-frame blockquote p { color: inherit !important; }
        .paseo-table-wrapper { position: relative; }
        .paseo-table-tools { position: absolute; top: 4px; right: 4px; z-index: 1; opacity: 0; }
        .paseo-table-wrapper:hover > .paseo-table-tools,
        .paseo-table-tools:focus-within, .paseo-table-tools:has([role="alert"]) { opacity: 1; }
        @media (hover: none) { .paseo-table-tools { opacity: 1; } }
      `}</style>
      {children}
      {controls.map(({ host }, index) =>
        createPortal(
          <TableCopy markdownSource={markdownSource} index={index} />,
          host,
          String(index),
        ),
      )}
    </div>
  );
}

function TableCopy({ markdownSource, index }: { markdownSource: string; index: number }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = useCallback(async () => {
    setPending(true);
    setError(null);
    const plainText = markdownTableSources(markdownSource)[index];
    const environment = getDefaultMarkdownClipboardEnvironment();
    try {
      if (!plainText) throw new Error(t("message.actions.copyTableFailed"));
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(plainText);
      else if ((await environment.writePlainText(plainText)) === false)
        throw new Error(t("message.actions.copyTableFailed"));
      setCopied(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }, [t, markdownSource, index]);
  return (
    <View dataSet={markdownCopyDataSet.ignore} style={styles.tools}>
      <Button
        size="xs"
        variant="ghost"
        onPress={copy}
        loading={pending}
        disabled={pending}
        leftIcon={copied ? Check : Copy}
        accessibilityLabel={copied ? t("message.actions.copied") : t("message.actions.copyTable")}
        testID="markdown-table-copy"
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  tools: { alignItems: "flex-end" },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface1,
    maxWidth: 240,
    padding: theme.spacing[2],
  },
}));
