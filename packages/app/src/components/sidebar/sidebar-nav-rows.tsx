import { router, usePathname } from "expo-router";
import { CalendarClock, History, Plus, Search } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ICON_STROKE_WIDTH } from "@/styles/theme";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarHeaderRow, type SidebarRowIcon } from "@/components/sidebar/sidebar-header-row";
import { DensityIcon } from "@/components/ui/density-icon";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHoverControlsAlwaysVisible } from "@/hooks/use-hover-controls-always-visible";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
} from "@/utils/host-routes";

type SidebarNavPresentation = "row" | "icon";

interface SidebarNavRowProps {
  onBeforeNavigate?: () => void;
  presentation?: SidebarNavPresentation;
}

interface SidebarNavRowsProps {
  onBeforeNavigate?: () => void;
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
  /** Sits to the right of the first row, which shrinks to make room. */
  firstRowTrailing?: ReactNode;
}

/**
 * Top-level sidebar navigation, ordered and filtered by the user's
 * `sidebarNavItems` preference. Renders nothing — not even the bordered group
 * wrapper — when every item is hidden and there is no `firstRowTrailing`.
 *
 * Where nobody can hover (native, compact layouts, touch tablets on the desktop layout) the
 * built-in entries collapse into one row of icon buttons so the workspace list keeps its height;
 * their labels stay as accessibility labels. A mouse keeps the labelled rows, whose hover
 * shortcut hints need one. Plugin entries are arbitrary surfaces, so they stay rows below.
 */
export function SidebarNavRows({ style, onBeforeNavigate, firstRowTrailing }: SidebarNavRowsProps) {
  const { items } = useSidebarNavItems("header");
  const visibleItems = useMemo(() => items.filter((item) => item.visible), [items]);
  const groupRef = useRef<View | null>(null);
  const iconPresentation = useHoverControlsAlwaysVisible();

  if (visibleItems.length === 0 && !firstRowTrailing) return null;

  function renderPlugin(item: Extract<(typeof visibleItems)[number], { kind: "plugin" }>) {
    return (
      <PluginSidebarItem
        key={item.key}
        group={item.group}
        section="header"
        fallbackAnchorRef={groupRef}
        onBeforeNavigate={onBeforeNavigate}
      />
    );
  }

  if (iconPresentation) {
    const icons: ReactNode[] = [];
    const pluginRows: ReactNode[] = [];
    for (const item of visibleItems) {
      if (item.kind === "plugin") {
        pluginRows.push(renderPlugin(item));
        continue;
      }
      const Row = BUILTIN_ROWS[item.id];
      icons.push(<Row key={item.key} onBeforeNavigate={onBeforeNavigate} presentation="icon" />);
    }
    return (
      <View ref={groupRef} collapsable={false} style={style}>
        {icons.length > 0 || firstRowTrailing ? (
          <View style={styles.iconRow} testID="sidebar-nav-icon-row">
            <View style={styles.iconRowItems}>{icons}</View>
            {firstRowTrailing}
          </View>
        ) : null}
        {pluginRows}
      </View>
    );
  }

  const [firstRow, ...restRows] = visibleItems.map((item) => {
    if (item.kind === "plugin") return renderPlugin(item);
    const Row = BUILTIN_ROWS[item.id];
    return <Row key={item.key} onBeforeNavigate={onBeforeNavigate} />;
  });

  return (
    <View ref={groupRef} collapsable={false} style={style}>
      {firstRowTrailing ? (
        <View style={styles.firstRow}>
          <View style={styles.firstRowItem}>{firstRow}</View>
          {firstRowTrailing}
        </View>
      ) : (
        firstRow
      )}
      {restRows}
    </View>
  );
}

interface SidebarNavEntryProps {
  presentation: SidebarNavPresentation;
  icon: SidebarRowIcon;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID: string;
  shortcutKeys?: ShortcutKey[][] | null;
}

function SidebarNavEntry({
  presentation,
  icon,
  label,
  onPress,
  isActive = false,
  testID,
  shortcutKeys = null,
}: SidebarNavEntryProps) {
  if (presentation === "icon") {
    return (
      <SidebarNavIconButton
        icon={icon}
        label={label}
        onPress={onPress}
        isActive={isActive}
        testID={testID}
        shortcutKeys={shortcutKeys}
      />
    );
  }
  return (
    <SidebarHeaderRow
      icon={icon}
      label={label}
      onPress={onPress}
      isActive={isActive}
      testID={testID}
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarNavIconButton({
  icon,
  label,
  onPress,
  isActive,
  testID,
  shortcutKeys,
}: Omit<SidebarNavEntryProps, "presentation">) {
  const isCompact = useIsCompactFormFactor();
  return (
    <ToolbarButton
      label={label}
      onPress={onPress}
      selected={isActive}
      compact={isCompact}
      round
      shortcut={shortcutKeys}
      testID={testID}
      aria-selected={isActive}
    >
      <DensityIcon
        icon={icon}
        size="md"
        color={isActive ? "foreground" : "foregroundMuted"}
        strokeWidth={ICON_STROKE_WIDTH}
      />
    </ToolbarButton>
  );
}

const SidebarNewWorkspaceRow = memo(function SidebarNewWorkspaceRow({
  onBeforeNavigate,
  presentation = "row",
}: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  return (
    <SidebarNavEntry
      presentation={presentation}
      icon={Plus}
      label={t(builtinSidebarNavLabelKey("new-workspace"))}
      onPress={handlePress}
      testID="sidebar-global-new-workspace"
      shortcutKeys={shortcutKeys}
    />
  );
});

function SidebarHistoryRow({ onBeforeNavigate, presentation = "row" }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSessionsRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarNavEntry
      presentation={presentation}
      icon={History}
      label={t(builtinSidebarNavLabelKey("history"))}
      onPress={handlePress}
      isActive={pathname.includes("/sessions")}
      testID="sidebar-sessions"
    />
  );
}

function SidebarSearchRow({ presentation = "row" }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handlePress = useCallback(() => {
    setCommandCenterOpen(true);
  }, [setCommandCenterOpen]);

  return (
    <SidebarNavEntry
      presentation={presentation}
      icon={Search}
      label={t(builtinSidebarNavLabelKey("search"))}
      onPress={handlePress}
      testID="sidebar-search"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarSchedulesRow({ onBeforeNavigate, presentation = "row" }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSchedulesRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarNavEntry
      presentation={presentation}
      icon={CalendarClock}
      label={t(builtinSidebarNavLabelKey("schedules"))}
      onPress={handlePress}
      isActive={pathname.includes("/schedules")}
      testID="sidebar-schedules"
    />
  );
}

const BUILTIN_ROWS: Record<BuiltinSidebarNavId, ComponentType<SidebarNavRowProps>> = {
  "new-workspace": SidebarNewWorkspaceRow,
  history: SidebarHistoryRow,
  search: SidebarSearchRow,
  schedules: SidebarSchedulesRow,
};

const styles = StyleSheet.create((theme) => ({
  firstRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  firstRowItem: {
    flex: 1,
    minWidth: 0,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  // Left-aligned like the rows they replace: the inset puts the first glyph's ink on the rows'
  // icon rail (row container + button padding), with the larger touch hitbox overhanging it.
  iconRowItems: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[1],
  },
}));
