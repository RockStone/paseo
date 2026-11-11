import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, type PluginButtonContentProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ComponentType,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, Text, type TextStyle, View } from "react-native";
import { formatRelativeTime, splitLinks } from "../shared/format";
import {
  addNoteRpc,
  deleteNoteRpc,
  listNotesRpc,
  markSeenRpc,
  MAX_TEXT_LENGTH,
  type Note,
} from "../shared/notes";

const OPEN_REFETCH_MS = 5_000;
const CLOCK_TICK_MS = 30_000;

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  // A round add button floating in the input's corner, like the composer's expand button:
  // translucent at rest, solid on hover.
  const addButton = {
    position: "absolute" as const,
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: colors.accent,
    opacity: 0.45,
  };
  const note = {
    gap: 4,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  };
  return {
    root: { gap: 12, width: compact ? undefined : 380, maxWidth: "100%" as const },
    composer: { position: "relative" as const },
    input: {
      minHeight: 64,
      maxHeight: 160,
      paddingLeft: 10,
      paddingRight: 42,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface0,
      color: colors.foreground,
      fontSize: 14,
      textAlignVertical: "top" as const,
    },
    addButton,
    addButtonHovered: { ...addButton, opacity: 1 },
    addButtonDisabled: { ...addButton, opacity: 0.25 },
    error: { color: colors.statusDanger, fontSize: 12 },
    empty: { color: colors.foregroundMuted, fontSize: 13, paddingVertical: 8 },
    list: { gap: 8 },
    note,
    noteNew: { ...note, borderColor: colors.accent },
    meta: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    author: { color: colors.foreground, fontSize: 12, fontWeight: "600" as const, flexShrink: 1 },
    time: { color: colors.foregroundMuted, fontSize: 12 },
    newTag: { color: colors.accent, fontSize: 11, fontWeight: "600" as const },
    spacer: { flex: 1 },
    deleteButton: { padding: 4, borderRadius: 6 },
    title: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, textDecorationLine: "underline" as const },
    url: { color: colors.accent, fontSize: 13, textDecorationLine: "underline" as const },
  };
}

type Styles = ReturnType<typeof createStyles>;

function open(url: string) {
  void openExternalUrl(url).catch((error: unknown) => {
    console.warn("[sticky-notes] Could not open link", error);
  });
}

function Link({ url, label, style }: { url: string; label: string; style: TextStyle }) {
  const onPress = useCallback(() => open(url), [url]);
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

function LinkedText({ text, styles }: { text: string; styles: Styles }) {
  const segments = useMemo(() => splitLinks(text), [text]);
  return (
    <Text style={styles.body}>
      {segments.map((segment) =>
        segment.kind === "link" ? (
          <Link key={segment.start} url={segment.url} label={segment.text} style={styles.link} />
        ) : (
          <Text key={segment.start}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

function NoteRow(props: {
  note: Note;
  isNew: boolean;
  now: Date;
  styles: Styles;
  iconColor: string;
  deleting: boolean;
  onDelete(id: string): void;
}) {
  const { note, isNew, now, styles, iconColor, deleting, onDelete } = props;
  const author = note.author.kind === "user" ? "You" : (note.author.agentTitle ?? "Agent");
  const handleDelete = useCallback(() => onDelete(note.id), [onDelete, note.id]);
  return (
    <View style={isNew ? styles.noteNew : styles.note}>
      <View style={styles.meta}>
        <Text style={styles.author} numberOfLines={1}>
          {author}
        </Text>
        <Text style={styles.time}>{formatRelativeTime(note.createdAt, now)}</Text>
        {isNew ? <Text style={styles.newTag}>New</Text> : null}
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete note"
          disabled={deleting}
          onPress={handleDelete}
          style={styles.deleteButton}
          hitSlop={6}
        >
          <Icon name="Trash2" size={14} color={iconColor} />
        </Pressable>
      </View>
      {note.title ? <Text style={styles.title}>{note.title}</Text> : null}
      <LinkedText text={note.text} styles={styles} />
      {note.url ? <Link url={note.url} label={note.url} style={styles.url} /> : null}
    </View>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds the popover body; `refreshBadges` updates the header labels after a change. */
export function createNotesPopover(
  refreshBadges: () => Promise<void>,
): ComponentType<PluginButtonContentProps> {
  return function StickyNotesPopover({ theme, layout, host, workspaceId }) {
    const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
    const queryClient = useQueryClient();
    const listNotes = useRpc(listNotesRpc);
    const addNote = useRpc(addNoteRpc);
    const deleteNote = useRpc(deleteNoteRpc);
    const markSeen = useRpc(markSeenRpc);
    const queryKey = useMemo(() => ["sticky-notes", host.id, workspaceId], [host.id, workspaceId]);
    const now = useClock();
    const [draft, setDraft] = useState("");
    // Notes that were unseen while this popover was open keep their highlight until it closes.
    const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());

    const notes = useQuery({
      queryKey,
      queryFn: () => listNotes({ workspaceId }),
      refetchInterval: OPEN_REFETCH_MS,
    });

    const invalidate = useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey });
      await refreshBadges();
    }, [queryClient, queryKey]);

    const seen = useMutation({ mutationFn: markSeen, onSettled: invalidate });
    const add = useMutation({
      mutationFn: addNote,
      onSuccess: () => setDraft(""),
      onSettled: invalidate,
    });
    const remove = useMutation({ mutationFn: deleteNote, onSettled: invalidate });

    const unseenIds = useMemo(
      () => (notes.data?.notes ?? []).filter((note) => note.seenAt === null).map((note) => note.id),
      [notes.data],
    );
    const { mutate: markWorkspaceSeen } = seen;
    const requested = useRef(new Set<string>());
    useEffect(() => {
      // Opening the popover, or a note arriving while it is open, marks agent notes seen once.
      const fresh = unseenIds.filter((id) => !requested.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) requested.current.add(id);
      setNewIds((previous) => new Set([...previous, ...fresh]));
      markWorkspaceSeen({ workspaceId });
    }, [unseenIds, markWorkspaceSeen, workspaceId]);

    const text = draft.trim();
    const canAdd = text.length > 0 && text.length <= MAX_TEXT_LENGTH && !add.isPending;
    const { mutate: addMutate } = add;
    const submit = useCallback(() => {
      if (canAdd) addMutate({ workspaceId, text });
    }, [canAdd, addMutate, workspaceId, text]);
    const { mutate: removeMutate } = remove;
    const handleDelete = useCallback(
      (id: string) => removeMutate({ workspaceId, id }),
      [removeMutate, workspaceId],
    );

    const addButtonStyle = useCallback(
      ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => {
        if (!canAdd) return styles.addButtonDisabled;
        return hovered || pressed ? styles.addButtonHovered : styles.addButton;
      },
      [canAdd, styles],
    );

    const error = add.error ?? remove.error ?? notes.error;
    const list = notes.data?.notes ?? [];
    const deletingId = remove.isPending ? remove.variables?.id : undefined;

    let body: ReactElement;
    if (notes.isPending) body = <Text style={styles.empty}>Loading notes…</Text>;
    else if (list.length === 0) body = <Text style={styles.empty}>No notes yet.</Text>;
    else
      body = (
        <View style={styles.list}>
          {list.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              isNew={newIds.has(note.id)}
              now={now}
              styles={styles}
              iconColor={theme.colors.foregroundMuted}
              deleting={deletingId === note.id}
              onDelete={handleDelete}
            />
          ))}
        </View>
      );

    return (
      <View style={styles.root}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a note for yourself or your agents"
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            maxLength={MAX_TEXT_LENGTH}
            style={styles.input}
            accessibilityLabel="New sticky note"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add note"
            accessibilityHint="Agents can read and add notes here"
            disabled={!canAdd}
            onPress={submit}
            style={addButtonStyle}
          >
            <Icon name="Plus" size={16} color={theme.colors.accentForeground} />
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
        {body}
      </View>
    );
  };
}
