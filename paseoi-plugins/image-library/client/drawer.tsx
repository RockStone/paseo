import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginButtonContentProps, useRpc } from "@getpaseo/plugin/client";
import * as ui from "@getpaseo/plugin/client/ui";
import { copyText, Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type ComponentType, memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  DEFAULT_PAGE_SIZE,
  type ImageEntry,
  type ImageFilter,
  imageBytesRpc,
  listImagesRpc,
  markSeenRpc,
  scanOlderRpc,
  stopScanRpc,
} from "../shared/images";
import { formatBytes, formatWhen } from "./format";
import { createStyles, type Styles } from "./theme";

const LIST_REFETCH_MS = 15_000;
const SCANNING_REFETCH_MS = 3_000;
const FILTERS: { id: ImageFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "you", label: "Mine" },
  { id: "agent", label: "Agents" },
];

interface Navigation {
  openAgent?: (input: { agentId: string }) => void;
}

/** Builds the drawer body; `refreshBadges` updates the header count after the drawer opens. */
export function createLibrary(
  refreshBadges: () => Promise<void>,
): ComponentType<PluginButtonContentProps> {
  return function ImageLibrary(props) {
    const { theme, host, workspaceId, layout, close } = props;
    const { navigation } = props as { navigation?: Navigation };
    const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
    const [filter, setFilter] = useState<ImageFilter>("all");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<ImageEntry | null>(null);
    const list = useRpc(listImagesRpc);
    const markSeen = useRpc(markSeenRpc);
    const scanOlder = useRpc(scanOlderRpc);
    const stopScan = useRpc(stopScanRpc);

    useEffect(() => {
      markSeen({ workspaceId })
        .then(refreshBadges)
        .catch(() => undefined);
    }, [markSeen, workspaceId]);

    const images = useInfiniteQuery({
      queryKey: ["image-library", "list", host.id, workspaceId, filter, query.trim()],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        list({
          workspaceId,
          filter,
          query: query.trim(),
          cursor: pageParam,
          limit: DEFAULT_PAGE_SIZE,
        }),
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchInterval: (state) =>
        state.state.data?.pages.at(-1)?.scanning || state.state.data?.pages.at(-1)?.older.running
          ? SCANNING_REFETCH_MS
          : LIST_REFETCH_MS,
    });
    const entries = useMemo(
      () => images.data?.pages.flatMap((page) => page.images) ?? [],
      [images.data],
    );
    const total = images.data?.pages[0]?.total ?? 0;
    const scanning = images.data?.pages.at(-1)?.scanning ?? false;
    const older = images.data?.pages.at(-1)?.older;
    const { refetch } = images;
    const startScan = useCallback(() => {
      scanOlder({ workspaceId })
        .then(() => refetch())
        .catch(() => undefined);
    }, [scanOlder, workspaceId, refetch]);
    const cancelScan = useCallback(() => {
      stopScan({})
        .then(() => refetch())
        .catch(() => undefined);
    }, [stopScan, refetch]);
    const { hasNextPage, isFetching, fetchNextPage } = images;
    const loadMore = useCallback(() => {
      if (hasNextPage && !isFetching) void fetchNextPage();
    }, [hasNextPage, isFetching, fetchNextPage]);
    const onScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
        if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 300) loadMore();
      },
      [loadMore],
    );
    const openAgent = useMemo(
      () =>
        navigation?.openAgent
          ? (agentId: string) => {
              navigation.openAgent?.({ agentId });
              close();
            }
          : undefined,
      [navigation, close],
    );
    const clearSelection = useCallback(() => setSelected(null), []);

    let body;
    if (selected) {
      body = (
        <Viewer
          entry={selected}
          hostId={host.id}
          styles={styles}
          theme={theme}
          onBack={clearSelection}
          onOpenAgent={openAgent}
        />
      );
    } else {
      body = (
        <>
          <Controls
            styles={styles}
            theme={theme}
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
          />
          <Grid
            styles={styles}
            theme={theme}
            hostId={host.id}
            entries={entries}
            total={total}
            loading={images.isPending}
            scanning={scanning}
            error={images.error}
            hasMore={!!hasNextPage}
            loadingMore={images.isFetchingNextPage}
            searching={!!query.trim() || filter !== "all"}
            onSelect={setSelected}
            onLoadMore={loadMore}
          />
          {older && (older.pending > 0 || older.running) ? (
            <OlderScan styles={styles} older={older} onStart={startScan} onStop={cancelScan} />
          ) : null}
        </>
      );
    }

    // In the drawer the controls scroll away with the grid and more loads near the bottom; the
    // compact sheet scrolls itself, so it keeps the Load more button.
    if (layout.compact || selected) {
      return <View style={styles.root}>{body}</View>;
    }
    return (
      <View style={styles.rootFill}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={200}
          onScroll={onScroll}
          showsVerticalScrollIndicator
        >
          {body}
        </ScrollView>
      </View>
    );
  };
}

function Controls(props: {
  styles: Styles;
  theme: PluginTheme;
  filter: ImageFilter;
  onFilter(next: ImageFilter): void;
  query: string;
  onQuery(next: string): void;
}) {
  const { styles, theme, filter, onFilter, query, onQuery } = props;
  const clear = useCallback(() => onQuery(""), [onQuery]);
  return (
    <>
      <View style={styles.segments} accessibilityRole="tablist">
        {FILTERS.map((option) => (
          <Segment
            key={option.id}
            styles={styles}
            id={option.id}
            label={option.label}
            active={filter === option.id}
            onSelect={onFilter}
          />
        ))}
      </View>
      <View style={styles.searchBox}>
        <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search by agent title"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.searchInput}
          accessibilityLabel="Search by agent title"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={clear}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function OlderScan(props: {
  styles: Styles;
  older: { pending: number; running: boolean; done: number; total: number };
  onStart(): void;
  onStop(): void;
}) {
  const { styles, older, onStart, onStop } = props;
  if (older.running) {
    return (
      <>
        <Text style={styles.meta}>
          Scanning older conversations… {older.done} of {older.total}
        </Text>
        <Pressable accessibilityRole="button" onPress={onStop} style={styles.button}>
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
      </>
    );
  }
  return (
    <Pressable accessibilityRole="button" onPress={onStart} style={styles.button}>
      <Text style={styles.buttonText}>Scan older conversations ({older.pending} not scanned)</Text>
    </Pressable>
  );
}

function Segment(props: {
  styles: Styles;
  id: ImageFilter;
  label: string;
  active: boolean;
  onSelect(id: ImageFilter): void;
}) {
  const { styles, id, label, active, onSelect } = props;
  const select = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable
      accessibilityRole="tab"
      aria-selected={active}
      onPress={select}
      style={active ? styles.segmentActive : styles.segment}
    >
      <Text style={active ? styles.segmentLabelActive : styles.segmentLabel}>{label}</Text>
    </Pressable>
  );
}

function Grid(props: {
  styles: Styles;
  theme: PluginTheme;
  hostId: string;
  entries: ImageEntry[];
  total: number;
  loading: boolean;
  scanning: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  searching: boolean;
  onSelect(entry: ImageEntry): void;
  onLoadMore(): void;
}) {
  const { styles, entries, total, loading, scanning, error, hasMore, loadingMore, searching } =
    props;
  if (error && entries.length === 0) {
    return (
      <Text style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text>
    );
  }
  if (loading)
    return <Text style={styles.empty}>Looking through the conversations in this workspace…</Text>;
  if (entries.length === 0) {
    return <Text style={styles.empty}>{emptyMessage(scanning, searching)}</Text>;
  }
  return (
    <>
      <Text style={styles.meta}>
        {total} {total === 1 ? "image" : "images"}
        {scanning ? " · indexing more…" : ""}
      </Text>
      <View style={styles.grid}>
        {entries.map((entry) => (
          <Tile
            key={entry.id}
            entry={entry}
            hostId={props.hostId}
            styles={styles}
            theme={props.theme}
            onSelect={props.onSelect}
          />
        ))}
      </View>
      {hasMore ? (
        <Pressable
          accessibilityRole="button"
          onPress={props.onLoadMore}
          disabled={loadingMore}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{loadingMore ? "Loading…" : "Load more"}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function emptyMessage(scanning: boolean, searching: boolean): string {
  if (scanning) return "Still indexing the agents in this workspace…";
  if (searching) return "No images match.";
  return "No images in this workspace yet.";
}

/** Props of the host's `ImageLightbox`, declared here because the pinned SDK predates it. */
interface LightboxProps {
  sources: readonly { uri: string }[];
  index: number;
  onClose(): void;
}
/** Hosts that predate `ImageLightbox` lack the export, so the large view stays in the drawer. */
const ImageLightbox = pickLightbox(ui);

function pickLightbox(module: object): ComponentType<LightboxProps> | null {
  const candidate = (module as { ImageLightbox?: unknown }).ImageLightbox;
  return typeof candidate === "function" ? (candidate as ComponentType<LightboxProps>) : null;
}

function dataUri(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function useImageBytes(hostId: string, id: string, variant: "thumb" | "full") {
  const bytes = useRpc(imageBytesRpc);
  return useQuery({
    queryKey: ["image-library", variant, hostId, id],
    queryFn: () => bytes({ id, variant }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

const Tile = memo(function Tile(props: {
  entry: ImageEntry;
  hostId: string;
  styles: Styles;
  theme: PluginTheme;
  onSelect(entry: ImageEntry): void;
}) {
  const { entry, hostId, styles, theme, onSelect } = props;
  const thumb = useImageBytes(hostId, entry.id, "thumb");
  const select = useCallback(() => onSelect(entry), [onSelect, entry]);
  const data = thumb.data?.data;
  const uri = useMemo(
    () => (thumb.data && data ? { uri: dataUri(thumb.data.mimeType, data) } : null),
    [thumb.data, data],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Image from ${entry.agentTitle}`}
      onPress={select}
      style={styles.tile}
    >
      {uri ? (
        <Image source={uri} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={styles.tilePlaceholder}>
          <Icon name="Image" size={20} color={theme.colors.foregroundMuted} />
          {thumb.isPending ? null : <Text style={styles.meta}>No preview</Text>}
        </View>
      )}
      <View style={styles.tileBadge}>
        <Text style={styles.tileBadgeText}>{entry.source === "you" ? "You" : "Agent"}</Text>
      </View>
    </Pressable>
  );
});

function Viewer(props: {
  entry: ImageEntry;
  hostId: string;
  styles: Styles;
  theme: PluginTheme;
  onBack(): void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const { entry, hostId, styles, theme, onBack, onOpenAgent } = props;
  const full = useImageBytes(hostId, entry.id, "full");
  const toast = useToast();
  const openAgent = useCallback(() => onOpenAgent?.(entry.agentId), [onOpenAgent, entry.agentId]);
  const copyPath = useCallback(() => {
    copyText(entry.path).then(
      () => toast.show("Path copied"),
      () => toast.error("Could not copy the path"),
    );
  }, [entry.path, toast]);
  const [zoomed, setZoomed] = useState(false);
  const openZoom = useCallback(() => setZoomed(true), []);
  const closeZoom = useCallback(() => setZoomed(false), []);
  const result = full.data;
  const source = useMemo(
    () => (result?.data ? { uri: dataUri(result.mimeType, result.data) } : null),
    [result],
  );
  const lightboxSources = useMemo(() => (source ? [source] : []), [source]);
  let picture;
  if (source) {
    const image = (
      <Image
        source={source}
        style={styles.viewerImage}
        resizeMode="contain"
        accessibilityLabel={entry.fileName}
      />
    );
    picture = ImageLightbox ? (
      <>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom image" onPress={openZoom}>
          {image}
        </Pressable>
        {zoomed ? <ImageLightbox sources={lightboxSources} index={0} onClose={closeZoom} /> : null}
      </>
    ) : (
      image
    );
  } else if (full.isPending) {
    picture = <Text style={styles.empty}>Loading…</Text>;
  } else {
    picture = (
      <Text style={styles.empty}>
        {result?.reason === "too-large"
          ? "This image is too large to show here. Copy its path to open it."
          : "This image is no longer on disk."}
      </Text>
    );
  }
  return (
    <>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.actionButton}>
          <Icon name="ArrowLeft" size={14} color={theme.colors.foreground} />
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
        {onOpenAgent ? (
          <Pressable accessibilityRole="button" onPress={openAgent} style={styles.actionButton}>
            <Icon name="MessageSquare" size={14} color={theme.colors.foreground} />
            <Text style={styles.buttonText}>Open agent</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={copyPath} style={styles.actionButton}>
          <Icon name="Copy" size={14} color={theme.colors.foreground} />
          <Text style={styles.buttonText}>Copy path</Text>
        </Pressable>
      </View>
      {picture}
      <Text style={styles.title}>{entry.agentTitle}</Text>
      <Text style={styles.meta}>
        {entry.source === "you" ? "You attached" : "Agent image"} · {formatWhen(entry.timestamp)} ·{" "}
        {formatBytes(entry.byteSize)}
      </Text>
      <Text style={styles.path} selectable>
        {entry.path}
      </Text>
    </>
  );
}
