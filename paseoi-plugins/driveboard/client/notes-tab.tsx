import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeSyntheticEvent,
  Pressable,
  Text,
  type TextInputKeyPressEventData,
  type TextStyle,
  View,
} from "react-native";
import { formatRelativeTime } from "../shared/format";
import { Link, Segments } from "./links";
import {
  addNoteRpc,
  deleteNoteRpc,
  listNotesRpc,
  markSeenRpc,
  MAX_TEXT_LENGTH,
  type Note,
} from "../shared/notes";
import { errorMessage, isSubmitChord, SUBMIT_HINT } from "./keys";
import { SearchField } from "./search-field";
import { useHighlights, useSearchQuery } from "./session";
import { filterNotes } from "../shared/search";
import type { Styles } from "./theme";

const OPEN_REFETCH_MS = 5_000;
const CLOCK_TICK_MS = 30_000;

/** A bullet starts its own line; punctuation hugs the text before it; anything else gets a space. */
function separatorBefore(text: string): string {
  if (/^(?:[-*+]|\d+\.)\s/.test(text)) return "\n";
  return /^[.,;:!?)\n]/.test(text) ? "" : " ";
}

/** One paragraph of text parts, bold parts highlighted, with links that open. */
export function RichText({
  parts,
  style,
  boldStyle,
  styles,
}: {
  parts: readonly { text: string; bold: boolean }[];
  style: TextStyle;
  boldStyle: TextStyle;
  styles: Styles;
}) {
  // The parser trims each part, so the spaces around a bold span come back here.
  const joined = useMemo(
    () =>
      parts.map((part, position) => ({
        ...part,
        key: `${position}`,
        text: position > 0 ? `${separatorBefore(part.text)}${part.text}` : part.text,
      })),
    [parts],
  );
  return (
    <Text style={style} selectable>
      {joined.map((part) => (
        <Segments
          key={part.key}
          text={part.text}
          style={part.bold ? boldStyle : undefined}
          linkStyle={styles.link}
          pathStyle={styles.path}
        />
      ))}
    </Text>
  );
}

export function LinkedText({
  text,
  style,
  styles,
}: {
  text: string;
  style: TextStyle;
  styles: Styles;
}) {
  return (
    <Segments
      text={text}
      style={style}
      linkStyle={styles.link}
      pathStyle={styles.path}
      selectable
    />
  );
}

function NoteRow(props: {
  note: Note;
  isNew: boolean;
  onSeen(id: string): void;
  now: Date;
  styles: Styles;
  iconColor: string;
  deleting: boolean;
  onDelete(id: string): void;
}) {
  const { note, isNew, onSeen, now, styles, iconColor, deleting, onDelete } = props;
  const author = note.author.kind === "user" ? "You" : (note.author.agentTitle ?? "Agent");
  const handleDelete = useCallback(() => onDelete(note.id), [onDelete, note.id]);
  const handleSeen = useCallback(() => onSeen(note.id), [onSeen, note.id]);
  return (
    <Pressable onPress={handleSeen} style={isNew ? styles.cardNew : styles.card}>
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
          style={styles.iconButton}
          hitSlop={6}
        >
          <Icon name="Trash2" size={14} color={iconColor} />
        </Pressable>
      </View>
      {note.title ? <Text style={styles.title}>{note.title}</Text> : null}
      <LinkedText text={note.text} style={styles.body} styles={styles} />
      {note.url ? <Link url={note.url} label={note.url} style={styles.url} /> : null}
    </Pressable>
  );
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Floating round submit button in a composer's corner. */
export function FloatingSubmit(props: {
  styles: Styles;
  theme: PluginTheme;
  enabled: boolean;
  label: string;
  icon: string;
  onPress(): void;
}) {
  const { styles, theme, enabled, label, icon, onPress } = props;
  const style = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => {
      if (!enabled) return styles.floatingButtonDisabled;
      return hovered || pressed ? styles.floatingButtonHovered : styles.floatingButton;
    },
    [enabled, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!enabled}
      onPress={onPress}
      style={style}
    >
      <Icon name={icon} size={16} color={theme.colors.accentForeground} />
    </Pressable>
  );
}

export function notesQueryKey(hostId: string, workspaceId: string) {
  return ["driveboard", "notes", hostId, workspaceId];
}

/** The workspace's sticky notes: yours and the ones agents pinned. */
export function NotesTab(props: {
  theme: PluginTheme;
  styles: Styles;
  hostId: string;
  workspaceId: string;
  web: boolean;
  refreshBadges(): Promise<void>;
}) {
  const { theme, styles, hostId, workspaceId, web, refreshBadges } = props;
  const queryClient = useQueryClient();
  const listNotes = useRpc(listNotesRpc);
  const addNote = useRpc(addNoteRpc);
  const deleteNote = useRpc(deleteNoteRpc);
  const markSeen = useRpc(markSeenRpc);
  const queryKey = useMemo(() => notesQueryKey(hostId, workspaceId), [hostId, workspaceId]);
  const now = useClock();
  const [draft, setDraft] = useState("");
  // Highlights last 30 minutes or until the note is tapped, across drawer closes.
  const highlights = useHighlights(workspaceId, "notes");
  const { show } = highlights;
  const [query, setQuery] = useSearchQuery(workspaceId, "notes");

  const notes = useQuery({
    queryKey,
    queryFn: () => listNotes({ workspaceId }),
    refetchInterval: OPEN_REFETCH_MS,
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    await refreshBadges();
  }, [queryClient, queryKey, refreshBadges]);

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
    // Opening the tab, or a note arriving while it is open, marks agent notes seen once.
    const fresh = unseenIds.filter((id) => !requested.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) requested.current.add(id);
    show(fresh.map((id) => ({ id, label: "New" })));
    markWorkspaceSeen({ workspaceId });
  }, [unseenIds, show, markWorkspaceSeen, workspaceId]);

  const text = draft.trim();
  const canAdd = text.length > 0 && text.length <= MAX_TEXT_LENGTH && !add.isPending;
  const { mutate: addMutate } = add;
  const submit = useCallback(() => {
    if (canAdd) addMutate({ workspaceId, text });
  }, [canAdd, addMutate, workspaceId, text]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (!isSubmitChord(event)) return;
      event.preventDefault();
      submit();
    },
    [submit],
  );
  const { mutate: removeMutate } = remove;
  const handleDelete = useCallback(
    (id: string) => removeMutate({ workspaceId, id }),
    [removeMutate, workspaceId],
  );

  const error = add.error ?? remove.error ?? notes.error;
  const all = notes.data?.notes;
  const list = useMemo(() => filterNotes(all ?? [], query), [all, query]);
  const deletingId = remove.isPending ? remove.variables?.id : undefined;

  let body: ReactElement;
  if (notes.isPending) body = <Text style={styles.empty}>Loading notes…</Text>;
  else if (!all || all.length === 0) body = <Text style={styles.empty}>No notes yet.</Text>;
  else if (list.length === 0) body = <Text style={styles.empty}>No matches</Text>;
  else
    body = (
      <View style={styles.list}>
        {list.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            isNew={highlights.labels.has(note.id)}
            onSeen={highlights.dismiss}
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
      <SearchField
        styles={styles}
        theme={theme}
        value={query}
        placeholder="Search notes"
        onChange={setQuery}
      />
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onKeyPress={handleKeyPress}
          placeholder="Write a note for yourself or your agents"
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          maxLength={MAX_TEXT_LENGTH}
          style={styles.input}
          accessibilityLabel="New sticky note"
          accessibilityHint={web ? SUBMIT_HINT : undefined}
        />
        <FloatingSubmit
          styles={styles}
          theme={theme}
          enabled={canAdd}
          label="Add note"
          icon="Plus"
          onPress={submit}
        />
      </View>
      {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
      {body}
    </View>
  );
}
