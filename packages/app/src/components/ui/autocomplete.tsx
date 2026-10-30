import { useCallback, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { ScrollView, Text, View, Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Bot, File, Folder, Terminal, MessageSquare, Layers } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { useRevealActiveItem } from "./scroll-reveal";

export interface AutocompleteOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  kind?:
    | "command"
    | "file"
    | "directory"
    | "agent_profile"
    | "terminal"
    | "thread"
    | "workspace"
    | "subagent";
}

const LEADING_ICONS = {
  file: File,
  directory: Folder,
  agent_profile: Bot,
  terminal: Terminal,
  thread: MessageSquare,
  subagent: MessageSquare,
  workspace: Layers,
};

interface AutocompleteProps {
  header?: ReactNode;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  maxHeight?: number;
}

const BOLT_GLYPH_PATTERN = /\u26A1|\uFE0F/gu;

function removeBoltGlyphs(value?: string): string | undefined {
  if (!value) {
    return value;
  }
  const cleaned = value.replace(BOLT_GLYPH_PATTERN, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

interface AutocompleteRowProps {
  option: AutocompleteOption;
  isSelected: boolean;
  mutedColor: string;
  onSelect: (option: AutocompleteOption) => void;
  activeItemRef: RefObject<View | null>;
  onRowLayout: () => void;
}

function AutocompleteRow({
  option,
  isSelected,
  mutedColor,
  onSelect,
  activeItemRef,
  onRowLayout,
}: AutocompleteRowProps) {
  const optionLabel = removeBoltGlyphs(option.label) ?? option.label;
  const optionDescription = removeBoltGlyphs(option.description);
  const isRichOption = option.kind !== undefined && option.kind !== "command";
  const iconKind = option.kind ?? "file";
  const LeadingIcon = iconKind === "command" ? File : LEADING_ICONS[iconKind];

  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const pressableStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.item,
      (hovered || pressed || isSelected) && styles.itemActive,
    ],
    [isSelected],
  );

  return (
    <Pressable
      testID={`autocomplete-option-${option.id}`}
      ref={isSelected ? activeItemRef : undefined}
      onLayout={isSelected ? onRowLayout : undefined}
      onPress={handlePress}
      style={pressableStyle}
    >
      {isRichOption ? (
        <>
          <View style={styles.itemLeading}>
            <LeadingIcon size={14} color={mutedColor} />
          </View>
          <View style={styles.itemMain}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemLabel}>{optionLabel}</Text>
              {removeBoltGlyphs(option.detail) ? (
                <Text style={styles.itemDetail}>{removeBoltGlyphs(option.detail)}</Text>
              ) : null}
            </View>
            {optionDescription ? (
              <Text style={styles.itemDescription} numberOfLines={1}>
                {optionDescription}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.itemMainRow}>
          <Text style={styles.itemLabel}>{optionLabel}</Text>
          {optionDescription ? (
            <Text style={styles.itemDescriptionInline} numberOfLines={1}>
              {optionDescription}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export function Autocomplete({
  header,
  options,
  selectedIndex,
  onSelect,
  isLoading = false,
  errorMessage,
  loadingText,
  emptyText,
  maxHeight = 220,
}: AutocompleteProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const resolvedLoadingText = loadingText ?? t("common.states.loading");
  const resolvedEmptyText = emptyText ?? t("common.empty.noResults");
  const scrollRef = useRef<ScrollView>(null);
  const listKey = useMemo(() => options.map((option) => option.id).join("\0"), [options]);
  const { activeItemRef, contentRef, onItemLayout, onViewportLayout, onScroll } =
    useRevealActiveItem({ activeIndex: selectedIndex, listKey, scrollRef });

  const selectedOption = options[selectedIndex];
  const containerStyle = useMemo(() => [styles.container, { maxHeight }], [maxHeight]);

  if (isLoading) {
    return (
      <View style={containerStyle}>
        {header}
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>{resolvedLoadingText}</Text>
        </View>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={containerStyle}>
        {header}
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>Error: {errorMessage}</Text>
        </View>
      </View>
    );
  }

  if (options.length === 0) {
    return (
      <View style={containerStyle}>
        {header}
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>{resolvedEmptyText}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outerWrapper}>
      {selectedOption?.kind === "command" && selectedOption.description ? (
        <View style={styles.detailCard}>
          <Text style={styles.detailLabel} numberOfLines={1}>
            {removeBoltGlyphs(selectedOption.label) ?? selectedOption.label}
          </Text>
          <Text style={styles.detailDescription} numberOfLines={2} ellipsizeMode="tail">
            {removeBoltGlyphs(selectedOption.description)}
          </Text>
          {selectedOption.detail ? (
            <Text style={styles.detailHint} numberOfLines={1}>
              {removeBoltGlyphs(selectedOption.detail)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={containerStyle}>
        {header}
        <ScrollView
          ref={scrollRef}
          onLayout={onViewportLayout}
          onContentSizeChange={onItemLayout}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.scrollView}
          keyboardShouldPersistTaps="always"
        >
          <View ref={contentRef} collapsable={false} style={styles.scrollContent}>
            {options.map((option, index) => (
              <AutocompleteRow
                key={option.id}
                option={option}
                isSelected={index === selectedIndex}
                mutedColor={theme.colors.foregroundMuted}
                onSelect={onSelect}
                activeItemRef={activeItemRef}
                onRowLayout={onItemLayout}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  outerWrapper: {
    flexShrink: 1,
    minHeight: 0,
    gap: theme.spacing[1],
  },
  detailCard: {
    flexShrink: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    ...theme.shadow.md,
  },
  detailLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  detailDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  detailHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  container: {
    flexShrink: 1,
    // Keep a complete selectable row (36), list padding (8), and borders (2).
    minHeight: 46,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  scrollView: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingVertical: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  itemLeading: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
  },
  itemActive: {
    backgroundColor: theme.colors.surface2,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
  },
  itemMainRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  itemLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  itemDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  itemDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  itemDescriptionInline: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyItem: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
})) as unknown as Record<string, object>;
