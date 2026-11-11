import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentType, type ReactElement, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type Board, readBoardRpc } from "../shared/board";
import { listNotesRpc, type Note } from "../shared/notes";
import { pendingReplyIds } from "../shared/prompt";
import { errorMessage } from "./keys";
import { createOpeners, type HostNavigation, OpenersProvider } from "./links";
import { NotesTab, notesQueryKey } from "./notes-tab";
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
  return function Driveboard(props) {
    const { theme, host, workspaceId, layout } = props;
    // Paseoi hosts pass navigation to header-button popovers; the published SDK types predate it.
    const { navigation } = props as { navigation?: HostNavigation };
    const styles = useMemo(() => createStyles(theme), [theme]);
    const openers = useMemo(
      () => createOpeners(navigation, workspaceId),
      [navigation, workspaceId],
    );
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
    // Shares the Notes tab's query, so the dot clears as soon as the tab marks notes seen.
    const listNotes = useRpc(listNotesRpc);
    const notesKey = useMemo(() => notesQueryKey(host.id, workspaceId), [host.id, workspaceId]);
    const notes = useQuery({
      queryKey: notesKey,
      queryFn: () => listNotes({ workspaceId }),
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
    const dots = tabDots(tab, data, notes.data?.notes);

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
      body = (
        <ProgressTab
          board={data}
          theme={theme}
          styles={styles}
          workspaceId={workspaceId}
          onChanged={onChanged}
        />
      );
    }

    const tabs = (
      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton
          styles={styles}
          id="owner"
          label="Owner todo"
          count={ownerCount(pending, waiting)}
          active={tab === "owner"}
          dot={dots.owner}
          onSelect={setTab}
        />
        <TabButton
          styles={styles}
          id="progress"
          label="Progress"
          count={data?.hasTasks && data.summary ? `${data.summary.percent}%` : undefined}
          active={tab === "progress"}
          dot={dots.progress}
          onSelect={setTab}
        />
        <TabButton
          styles={styles}
          id="notes"
          label="Notes"
          active={tab === "notes"}
          dot={dots.notes}
          onSelect={setTab}
        />
      </View>
    );

    // In the drawer the tabs stay put and the tab scrolls under them; the compact sheet scrolls
    // everything itself.
    if (layout.compact) {
      return (
        <OpenersProvider value={openers}>
          <View style={styles.root}>
            {tabs}
            {body}
          </View>
        </OpenersProvider>
      );
    }
    return (
      <OpenersProvider value={openers}>
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
      </OpenersProvider>
    );
  };
}

/** A dot marks a tab with updates the owner has not seen; the open tab marks them seen. */
function tabDots(tab: TabId, board: Board | undefined, notes: Note[] | undefined) {
  return {
    owner: tab !== "owner" && (board?.newOwnerIds.length ?? 0) > 0,
    progress: tab !== "progress" && (board?.newTaskIds.length ?? 0) > 0,
    notes: tab !== "notes" && (notes ?? []).some((note) => note.seenAt === null),
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
  dot: boolean;
  onSelect(id: TabId): void;
}) {
  const { styles, id, label, count, active, dot, onSelect } = props;
  const select = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={dot ? `${label}, updated` : label}
      aria-selected={active}
      onPress={select}
      style={active ? styles.tabActive : styles.tab}
    >
      <Text style={active ? styles.tabLabelActive : styles.tabLabel}>{label}</Text>
      {count ? <Text style={styles.tabCount}>{count}</Text> : null}
      {dot ? <View style={styles.tabDot} testID={`driveboard-tab-dot-${id}`} /> : null}
    </Pressable>
  );
}
