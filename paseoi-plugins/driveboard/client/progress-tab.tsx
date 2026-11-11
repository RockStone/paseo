import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Board, TrackerItem } from "../shared/board";
import { LinkedText } from "./notes-tab";
import { SectionHeader } from "./owner-tab";
import type { Styles } from "./theme";

const RANK_NAMES: Record<number, string> = { 3: "Critical", 2: "Product", 1: "Later" };

/** The project's progress from docs/drive.md: totals, then tasks by status and rank. */
export function ProgressTab({
  board,
  theme,
  styles,
}: {
  board: Board;
  theme: PluginTheme;
  styles: Styles;
}) {
  const [showDone, setShowDone] = useState(false);
  const toggleDone = useCallback(() => setShowDone((value) => !value), []);
  const percent = board.summary?.percent ?? 0;
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${percent}%` as const }],
    [styles.progressFill, percent],
  );
  const groups = useMemo(() => {
    const valid = board.tasks.filter((item) => item.warnings.length === 0);
    const byRank = (items: TrackerItem[]) =>
      [...items].sort((a, b) => b.rank - a.rank || a.line - b.line);
    return {
      inProgress: byRank(valid.filter((item) => item.status === "in progress")),
      open: byRank(valid.filter((item) => item.status === "open")),
      done: valid.filter((item) => item.status === "done").sort((a, b) => b.line - a.line),
      invalid: board.tasks.filter((item) => item.warnings.length > 0),
    };
  }, [board.tasks]);

  if (!board.hasTasks || !board.summary) {
    return (
      <Text style={styles.empty}>
        {board.project?.name ?? "This project"} has no docs/drive.md yet, so there is no progress to
        show.
      </Text>
    );
  }
  const { summary } = board;
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.meta}>
          <Text style={styles.percent}>{summary.percent}%</Text>
          <Text style={styles.muted}>
            {summary.done} of {summary.total} tasks done
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={fillStyle} />
        </View>
        <View style={styles.stats}>
          {summary.ranks.map((rank) => (
            <View key={rank.rank} style={styles.pill}>
              <Text style={styles.pillText}>
                {rank.name} {rank.total - rank.open}/{rank.total}
              </Text>
            </View>
          ))}
          <View style={styles.pill}>
            <Text style={styles.pillText}>{summary.inProgress} in progress</Text>
          </View>
          <View style={summary.waiting > 0 ? styles.pillAccent : styles.pill}>
            <Text style={summary.waiting > 0 ? styles.pillAccentText : styles.pillText}>
              {summary.waiting} waiting on you
            </Text>
          </View>
        </View>
      </View>
      <TaskGroup styles={styles} theme={theme} label="In progress" items={groups.inProgress} />
      <TaskGroup styles={styles} theme={theme} label="Open" items={groups.open} />
      {groups.invalid.length > 0 ? (
        <TaskGroup styles={styles} theme={theme} label="Needs correction" items={groups.invalid} />
      ) : null}
      {groups.done.length > 0 ? (
        <View style={styles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showDone ? "Hide done tasks" : "Show done tasks"}
            onPress={toggleDone}
          >
            <SectionHeader
              styles={styles}
              label="Done"
              count={groups.done.length}
              chevron={showDone ? "ChevronDown" : "ChevronRight"}
              chevronColor={theme.colors.foregroundMuted}
            />
          </Pressable>
          {showDone
            ? groups.done.map((item) => (
                <TaskRow
                  key={`${item.id}-${item.line}`}
                  item={item}
                  styles={styles}
                  theme={theme}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

function TaskGroup(props: {
  styles: Styles;
  theme: PluginTheme;
  label: string;
  items: TrackerItem[];
}) {
  const { styles, theme, label, items } = props;
  if (items.length === 0) return null;
  return (
    <View style={styles.list}>
      <SectionHeader styles={styles} label={label} count={items.length} />
      {items.map((item) => (
        <TaskRow key={`${item.id}-${item.line}`} item={item} styles={styles} theme={theme} />
      ))}
    </View>
  );
}

function TaskRow({
  item,
  styles,
  theme,
}: {
  item: TrackerItem;
  styles: Styles;
  theme: PluginTheme;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const hasDetails = item.text.length > 0 || item.warnings.length > 0;
  const rank = RANK_NAMES[item.rank];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.id} ${item.title}`}
      aria-expanded={expanded}
      disabled={!hasDetails}
      onPress={toggle}
      style={item.status === "done" ? styles.cardMuted : styles.card}
    >
      <View style={styles.meta}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{item.id}</Text>
        </View>
        {rank ? <Text style={styles.mutedTag}>{rank}</Text> : null}
        <View style={styles.spacer} />
        {hasDetails ? (
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        ) : null}
      </View>
      <Text style={styles.title}>{item.title.replace(/^[A-Z]+-\d+\s+/, "")}</Text>
      {expanded ? <LinkedText text={item.text} style={styles.muted} styles={styles} /> : null}
      {expanded
        ? item.warnings.map((warning) => (
            <Text key={warning} style={styles.error}>
              {warning}
            </Text>
          ))
        : null}
    </Pressable>
  );
}
