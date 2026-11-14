import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeSyntheticEvent,
  Pressable,
  Text,
  type TextInputKeyPressEventData,
  View,
} from "react-native";
import {
  addReplyRpc,
  type Board,
  dismissRpc,
  editReplyRpc,
  markOwnersSeenRpc,
  notifyRpc,
  removeReplyRpc,
  type TrackerItem,
  type TrackerReply,
} from "../shared/board";
import { pendingReplyIds } from "../shared/prompt";
import { filterItems } from "../shared/search";
import { errorMessage, isSubmitChord, SUBMIT_HINT } from "./keys";
import { FloatingSubmit, LinkedText, RichText } from "./notes-tab";
import { SearchField } from "./search-field";
import { useHighlights, useSearchQuery } from "./session";
import type { Styles } from "./theme";

const RANKS = [
  { rank: 3, name: "Critical" },
  { rank: 2, name: "Product" },
  { rank: 1, name: "Later" },
] as const;

interface OwnerTabProps {
  board: Board;
  theme: PluginTheme;
  styles: Styles;
  workspaceId: string;
  web: boolean;
  onChanged(): Promise<void>;
}

/** Owner to-dos from docs/owner-todo.md: read, reply and send the replies to the agent. */
export function OwnerTab(props: OwnerTabProps) {
  const { board, styles, workspaceId, onChanged } = props;
  const [showDone, setShowDone] = useState(false);
  const toggleDone = useCallback(() => setShowDone((value) => !value), []);
  const markSeen = useRpc(markOwnersSeenRpc);
  // Highlights last 30 minutes or until the card is tapped, across drawer closes.
  const highlights = useHighlights(workspaceId, "owner");
  const { show } = highlights;
  const requested = useRef(new Set<string>());
  const { mutate: markOwnersSeen } = useMutation({ mutationFn: markSeen, onSettled: onChanged });
  useEffect(() => {
    const fresh = board.newOwnerIds.filter((id) => !requested.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) requested.current.add(id);
    show(fresh.map((id) => ({ id, label: "New" })));
    markOwnersSeen({ workspaceId });
  }, [board.newOwnerIds, show, markOwnersSeen, workspaceId]);
  const [query, setQuery] = useSearchQuery(workspaceId, "owner");
  const searching = query.trim().length > 0;

  const groups = useMemo(() => {
    const owners = filterItems(board.owners, query);
    const valid = owners.filter((item) => item.warnings.length === 0);
    const open = valid.filter((item) => item.status !== "done");
    return {
      ranks: RANKS.map(({ rank, name }) => ({
        name,
        items: open.filter((item) => item.rank === rank),
      })).filter((group) => group.items.length > 0),
      done: valid.filter((item) => item.status === "done"),
      invalid: owners.filter((item) => item.warnings.length > 0),
    };
  }, [board.owners, query]);
  const matchCount =
    groups.ranks.reduce((sum, group) => sum + group.items.length, 0) +
    groups.done.length +
    groups.invalid.length;

  if (!board.hasOwners) {
    return (
      <Text style={styles.empty}>
        {board.project?.name ?? "This project"} has no docs/owner-todo.md yet. Agents add owner
        to-dos there as “- [ ] **OT-1 Title.** details &lt;!-- priority:3 --&gt;”.
      </Text>
    );
  }

  return (
    <View style={styles.root}>
      <SearchField
        styles={styles}
        theme={props.theme}
        value={query}
        placeholder="Search owner to-dos"
        onChange={setQuery}
      />
      <NotifyBanner {...props} />
      {searching && matchCount === 0 ? <Text style={styles.empty}>No matches</Text> : null}
      {!searching && groups.ranks.length === 0 ? (
        <Text style={styles.empty}>Nothing is waiting on you.</Text>
      ) : null}
      {groups.ranks.map((group) => (
        <View key={group.name} style={styles.list}>
          <SectionHeader styles={styles} label={group.name} count={group.items.length} />
          {group.items.map((item) => (
            <OwnerCard
              key={item.id}
              {...props}
              item={item}
              newLabel={highlights.labels.get(item.id)}
              onSeen={highlights.dismiss}
            />
          ))}
        </View>
      ))}
      {groups.invalid.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader styles={styles} label="Needs correction" count={groups.invalid.length} />
          {groups.invalid.map((item) => (
            <View key={`${item.id}-${item.line}`} style={styles.card}>
              <Text style={styles.title}>{item.title}</Text>
              {item.warnings.map((warning) => (
                <Text key={warning} style={styles.error}>
                  {warning}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {groups.done.length > 0 ? (
        <View style={styles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showDone || searching ? "Hide done owner to-dos" : "Show done owner to-dos"
            }
            onPress={toggleDone}
          >
            <SectionHeader
              styles={styles}
              label="Done"
              count={groups.done.length}
              chevron={showDone || searching ? "ChevronDown" : "ChevronRight"}
              chevronColor={props.theme.colors.foregroundMuted}
            />
          </Pressable>
          {showDone || searching
            ? groups.done.map((item) => (
                <OwnerCard key={item.id} {...props} item={item} newLabel={undefined} />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

export function SectionHeader(props: {
  styles: Styles;
  label: string;
  count: number;
  chevron?: string;
  chevronColor?: string;
}) {
  const { styles, label, count, chevron, chevronColor } = props;
  return (
    <View style={styles.section}>
      {chevron ? <Icon name={chevron} size={14} color={chevronColor} /> : null}
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

const MAX_REPLY_PREVIEWS = 5;

/** One line per pending reply: the to-do id, then the reply with whitespace collapsed. */
function replyPreviews(owners: TrackerItem[], pending: string[]) {
  const wanted = new Set(pending);
  const all = owners.flatMap((item) =>
    item.replies
      .filter((reply) => wanted.has(reply.id))
      .map((reply) => ({
        id: reply.id,
        itemId: item.id,
        text: reply.text.replace(/\s+/g, " ").trim(),
      })),
  );
  return {
    shown: all.slice(0, MAX_REPLY_PREVIEWS),
    more: Math.max(0, all.length - MAX_REPLY_PREVIEWS),
  };
}

function NotifyBanner({ board, styles, workspaceId, onChanged }: OwnerTabProps) {
  const notify = useRpc(notifyRpc);
  const dismiss = useRpc(dismissRpc);
  const pending = useMemo(
    () => pendingReplyIds(board.owners, board.notifiedReplyIds),
    [board.owners, board.notifiedReplyIds],
  );
  const send = useMutation({ mutationFn: notify, onSettled: onChanged });
  const skip = useMutation({ mutationFn: dismiss, onSettled: onChanged });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { mutate: sendMutate } = send;
  const { mutate: skipMutate } = skip;
  const busy = send.isPending || skip.isPending;
  const onSend = useCallback(
    () =>
      sendMutate(
        { workspaceId, version: board.version, replyIds: pending },
        { onSuccess: ({ agentTitle }) => setSentTo(agentTitle) },
      ),
    [sendMutate, workspaceId, board.version, pending],
  );
  const onDismiss = useCallback(
    () => skipMutate({ workspaceId, replyIds: pending }),
    [skipMutate, workspaceId, pending],
  );
  const error = send.error ?? skip.error;

  if (pending.length === 0) {
    if (sentTo) return <Text style={styles.muted}>Sent your replies to {sentTo}.</Text>;
    return error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null;
  }
  const replies = pending.length === 1 ? "1 new reply" : `${pending.length} new replies`;
  const previews = replyPreviews(board.owners, pending);
  return (
    <View style={styles.banner}>
      <Text style={styles.body}>
        {board.agent
          ? `${replies} for ${board.agent.title}.`
          : `${replies}. This workspace has no agent to send them to.`}
      </Text>
      {previews.shown.map((preview) => (
        <Text key={preview.id} style={styles.muted} numberOfLines={1}>
          <Text style={styles.previewId}>{preview.itemId}</Text> {preview.text}
        </Text>
      ))}
      {previews.more > 0 ? <Text style={styles.muted}>and {previews.more} more</Text> : null}
      <View style={styles.actions}>
        {board.agent ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send replies to ${board.agent.title}`}
            disabled={busy}
            onPress={onSend}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{send.isPending ? "Sending…" : "Send to agent"}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss new replies"
          accessibilityHint="Marks them sent without prompting the agent"
          disabled={busy}
          onPress={onDismiss}
        >
          <Text style={styles.action}>Dismiss</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
    </View>
  );
}

function OwnerCard(
  props: OwnerTabProps & {
    item: TrackerItem;
    newLabel: string | undefined;
    onSeen?(id: string): void;
  },
) {
  const { item, newLabel, onSeen, styles, theme } = props;
  const isNew = newLabel !== undefined;
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => {
    onSeen?.(item.id);
    setExpanded((value) => !value);
  }, [onSeen, item.id]);
  const replied = item.replies.length > 0;
  const done = item.status === "done";
  let cardStyle = styles.card;
  if (isNew) cardStyle = styles.cardNew;
  else if (done || (replied && !expanded)) cardStyle = styles.cardMuted;
  return (
    <View style={cardStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.id} ${item.title}`}
        aria-expanded={expanded}
        onPress={toggle}
        style={styles.list}
      >
        <View style={styles.meta}>
          <View style={isNew ? styles.pillAccent : styles.pill}>
            <Text style={isNew ? styles.pillAccentText : styles.pillText}>{item.id}</Text>
          </View>
          {item.status === "in progress" ? <Text style={styles.mutedTag}>In progress</Text> : null}
          {isNew ? <Text style={styles.newTag}>{newLabel}</Text> : null}
          {replied ? (
            <Text style={styles.mutedTag}>
              {item.replies.length === 1 ? "Replied" : `${item.replies.length} replies`}
            </Text>
          ) : null}
          <View style={styles.spacer} />
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </View>
        <Text style={styles.title}>{item.title}</Text>
        {!expanded && item.text ? (
          <Text style={styles.muted} numberOfLines={2}>
            {item.text}
          </Text>
        ) : null}
      </Pressable>
      {expanded ? <OwnerDetails {...props} /> : null}
    </View>
  );
}

function OwnerDetails(props: OwnerTabProps & { item: TrackerItem }) {
  const { item, styles } = props;
  return (
    <View style={styles.list}>
      {item.detailBlocks.length > 0 ? (
        <RichText
          parts={item.detailBlocks}
          style={styles.muted}
          boldStyle={styles.strong}
          styles={styles}
        />
      ) : null}
      {item.replies.map((reply) => (
        <ReplyRow key={reply.id} {...props} reply={reply} />
      ))}
      <ReplyComposer {...props} />
    </View>
  );
}

function stamp(reply: TrackerReply): string {
  return reply.time ? `${reply.date} ${reply.time} UTC` : reply.date;
}

function ReplyRow(props: OwnerTabProps & { item: TrackerItem; reply: TrackerReply }) {
  const { item, reply, board, styles, theme, workspaceId, web, onChanged } = props;
  const editReply = useRpc(editReplyRpc);
  const removeReply = useRpc(removeReplyRpc);
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useMutation({
    mutationFn: editReply,
    onSuccess: () => setDraft(null),
    onSettled: onChanged,
  });
  const remove = useMutation({ mutationFn: removeReply, onSettled: onChanged });
  const { mutate: editMutate } = edit;
  const text = draft?.trim() ?? "";
  const canSave = text.length > 0 && text !== reply.text && !edit.isPending;
  const save = useCallback(() => {
    if (canSave) {
      editMutate({ workspaceId, version: board.version, id: item.id, replyId: reply.id, text });
    }
  }, [canSave, editMutate, workspaceId, board.version, item.id, reply.id, text]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (!isSubmitChord(event)) return;
      event.preventDefault();
      save();
    },
    [save],
  );
  const { mutate: removeMutate } = remove;
  const onRemove = useCallback(
    () => removeMutate({ workspaceId, version: board.version, id: item.id, replyId: reply.id }),
    [removeMutate, workspaceId, board.version, item.id, reply.id],
  );
  const startEdit = useCallback(() => setDraft(reply.text), [reply.text]);
  const cancel = useCallback(() => setDraft(null), []);
  const error = edit.error ?? remove.error;

  if (draft !== null) {
    return (
      <View style={styles.list}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onKeyPress={handleKeyPress}
            multiline
            maxLength={4000}
            style={styles.input}
            accessibilityLabel={`Edit reply on ${item.id}`}
            accessibilityHint={web ? SUBMIT_HINT : undefined}
            autoFocus
          />
          <FloatingSubmit
            styles={styles}
            theme={theme}
            enabled={canSave}
            label="Save reply"
            icon="Check"
            onPress={save}
          />
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={cancel}>
            <Text style={styles.action}>Cancel</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.reply}>
      <View style={styles.meta}>
        <Text style={styles.author}>You</Text>
        <Text style={styles.time}>{stamp(reply)}</Text>
        <View style={styles.spacer} />
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit reply" onPress={startEdit}>
            <Text style={styles.action}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove reply"
            disabled={remove.isPending}
            onPress={onRemove}
          >
            <Text style={styles.action}>Remove</Text>
          </Pressable>
        </View>
      </View>
      <LinkedText text={reply.text} style={styles.body} styles={styles} />
      {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
    </View>
  );
}

// Unsent replies survive collapsing a card and closing the drawer, for this app session only.
const drafts = new Map<string, string>();

function useDraft(key: string): [string, (text: string) => void] {
  const [draft, setDraftState] = useState(() => drafts.get(key) ?? "");
  const setDraft = useCallback(
    (text: string) => {
      if (text) drafts.set(key, text);
      else drafts.delete(key);
      setDraftState(text);
    },
    [key],
  );
  return [draft, setDraft];
}

function ReplyComposer(props: OwnerTabProps & { item: TrackerItem }) {
  const { item, board, styles, theme, workspaceId, web, onChanged } = props;
  const addReply = useRpc(addReplyRpc);
  const [draft, setDraft] = useDraft(`${workspaceId}:${item.id}`);
  const add = useMutation({
    mutationFn: addReply,
    onSuccess: () => setDraft(""),
    onSettled: onChanged,
  });
  const text = draft.trim();
  const canAdd = text.length > 0 && text.length <= 4000 && !add.isPending;
  const { mutate } = add;
  const submit = useCallback(() => {
    if (canAdd) mutate({ workspaceId, version: board.version, id: item.id, text });
  }, [canAdd, mutate, workspaceId, board.version, item.id, text]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (!isSubmitChord(event)) return;
      event.preventDefault();
      submit();
    },
    [submit],
  );
  return (
    <View style={styles.list}>
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onKeyPress={handleKeyPress}
          placeholder={`Reply to ${item.id}`}
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          maxLength={4000}
          style={styles.input}
          accessibilityLabel={`Reply to ${item.id}`}
          accessibilityHint={web ? SUBMIT_HINT : undefined}
        />
        <FloatingSubmit
          styles={styles}
          theme={theme}
          enabled={canAdd}
          label="Save reply"
          icon="ArrowUp"
          onPress={submit}
        />
      </View>
      {add.error ? <Text style={styles.error}>{errorMessage(add.error)}</Text> : null}
    </View>
  );
}
