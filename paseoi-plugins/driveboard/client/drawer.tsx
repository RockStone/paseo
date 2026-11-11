import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentType, type ReactElement, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { readBoardRpc } from "../shared/board";
import { pendingReplyIds } from "../shared/prompt";
import { errorMessage } from "./keys";
import { NotesTab } from "./notes-tab";
import { OwnerTab } from "./owner-tab";
import { ProgressTab } from "./progress-tab";
import { createStyles, type Styles } from "./theme";

const BOARD_REFETCH_MS = 5_000;

type TabId = "owner" | "progress" | "notes";

// The last tab per workspace, for this app session. Owner to-dos are the default.
const lastTabs = new Map<string, TabId>();

/** Builds the drawer body; `refreshBadges` updates the header counts after a change. */
export function createDriveboard(
  refreshBadges: () => Promise<void>,
): ComponentType<PluginButtonContentProps> {
  return function Driveboard({ theme, host, workspaceId, layout }) {
    const styles = useMemo(() => createStyles(theme), [theme]);
    const queryClient = useQueryClient();
    const readBoard = useRpc(readBoardRpc);
    const queryKey = useMemo(
      () => ["driveboard", "board", host.id, workspaceId],
      [host.id, workspaceId],
    );
    const board = useQuery({
      queryKey,
      queryFn: () => readBoard({ workspaceId }),
      refetchInterval: BOARD_REFETCH_MS,
    });
    const [tab, setTabState] = useState<TabId>(() => lastTabs.get(workspaceId) ?? "owner");
    const setTab = useCallback(
      (next: TabId) => {
        lastTabs.set(workspaceId, next);
        setTabState(next);
      },
      [workspaceId],
    );
    const onChanged = useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey });
      await refreshBadges();
    }, [queryClient, queryKey]);

    const data = board.data;
    const waiting = data?.summary?.waiting ?? 0;
    const pending = data ? pendingReplyIds(data.owners, data.notifiedReplyIds).length : 0;
    const web = layout.platform === "web";

    let body: ReactElement;
    if (tab === "notes") {
      body = (
        <NotesTab
          theme={theme}
          styles={styles}
          hostId={host.id}
          workspaceId={workspaceId}
          web={web}
          refreshBadges={refreshBadges}
        />
      );
    } else if (!data) {
      body = (
        <Text style={board.error ? styles.error : styles.empty}>
          {board.error ? errorMessage(board.error) : "Loading the board…"}
        </Text>
      );
    } else if (data.error) {
      body = <Text style={styles.error}>{data.error}</Text>;
    } else if (tab === "owner") {
      body = (
        <OwnerTab
          board={data}
          theme={theme}
          styles={styles}
          workspaceId={workspaceId}
          web={web}
          onChanged={onChanged}
        />
      );
    } else {
      body = <ProgressTab board={data} theme={theme} styles={styles} />;
    }

    const tabs = (
      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton
          styles={styles}
          id="owner"
          label="Owner todo"
          count={ownerCount(pending, waiting)}
          active={tab === "owner"}
          onSelect={setTab}
        />
        <TabButton
          styles={styles}
          id="progress"
          label="Progress"
          count={data?.hasTasks && data.summary ? `${data.summary.percent}%` : undefined}
          active={tab === "progress"}
          onSelect={setTab}
        />
        <TabButton
          styles={styles}
          id="notes"
          label="Notes"
          active={tab === "notes"}
          onSelect={setTab}
        />
      </View>
    );

    // In the drawer the tabs stay put and the tab scrolls under them; the compact sheet scrolls
    // everything itself.
    if (layout.compact) {
      return (
        <View style={styles.root}>
          {tabs}
          {body}
        </View>
      );
    }
    return (
      <View style={styles.rootFill}>
        {tabs}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {body}
        </ScrollView>
      </View>
    );
  };
}

/** New replies to send come first; otherwise how many to-dos wait on the owner. */
function ownerCount(pending: number, waiting: number): string | undefined {
  if (pending > 0) return `${pending} new`;
  return waiting > 0 ? String(waiting) : undefined;
}

function TabButton(props: {
  styles: Styles;
  id: TabId;
  label: string;
  count?: string;
  active: boolean;
  onSelect(id: TabId): void;
}) {
  const { styles, id, label, count, active, onSelect } = props;
  const select = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      aria-selected={active}
      onPress={select}
      style={active ? styles.tabActive : styles.tab}
    >
      <Text style={active ? styles.tabLabelActive : styles.tabLabel}>{label}</Text>
      {count ? <Text style={styles.tabCount}>{count}</Text> : null}
    </Pressable>
  );
}
