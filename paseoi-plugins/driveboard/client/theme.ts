import type { PluginTheme } from "@getpaseo/plugin";

/** `#rrggbb` (or short form) with an alpha, or null for other color formats. */
function withAlpha(color: string, alpha: number): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : match[1];
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}

/** The drawer's shared look: the sticky note's cards, in the app's own tokens. */
export function createStyles(theme: PluginTheme) {
  const { colors } = theme;
  // A round button floating in an input's corner, like the composer's expand button:
  // translucent at rest, solid on hover.
  const floatingButton = {
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
  const card = {
    gap: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  };
  const tab = {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 6,
    borderRadius: 6,
  };
  const pill = {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  };
  return {
    root: { gap: 10 },
    rootFill: { flex: 1, gap: 10 },
    scroll: { flex: 1 },
    scrollContent: { gap: 10, paddingBottom: 16 },
    tabs: {
      flexDirection: "row" as const,
      gap: 4,
      padding: 3,
      borderRadius: 8,
      backgroundColor: colors.surface0,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tab,
    tabActive: { ...tab, backgroundColor: colors.surface2 },
    tabLabel: { color: colors.foregroundMuted, fontSize: 13, fontWeight: "500" as const },
    tabLabelActive: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    tabDot: {
      position: "absolute" as const,
      top: 4,
      right: 6,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.statusDanger,
    },
    tabCount: { color: colors.accent, fontSize: 12, fontWeight: "600" as const },
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
    floatingButton,
    floatingButtonHovered: { ...floatingButton, opacity: 1 },
    floatingButtonDisabled: { ...floatingButton, opacity: 0.25 },
    error: { color: colors.statusDanger, fontSize: 12 },
    empty: { color: colors.foregroundMuted, fontSize: 13, paddingVertical: 8, lineHeight: 19 },
    list: { gap: 8 },
    card,
    // A box highlight: accent border and a faint accent wash over the card background.
    cardNew: {
      ...card,
      borderWidth: 2,
      padding: 9,
      borderColor: colors.accent,
      backgroundColor: withAlpha(colors.accent, 0.14) ?? colors.surface2,
    },
    searchBox: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      height: 32,
      paddingHorizontal: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface0,
    },
    searchInput: { flex: 1, paddingVertical: 0, color: colors.foreground, fontSize: 13 },
    cardMuted: { ...card, opacity: 0.7 },
    meta: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    author: { color: colors.foreground, fontSize: 12, fontWeight: "600" as const, flexShrink: 1 },
    time: { color: colors.foregroundMuted, fontSize: 12 },
    newTag: { color: colors.accent, fontSize: 11, fontWeight: "600" as const },
    mutedTag: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "500" as const },
    spacer: { flex: 1 },
    iconButton: { padding: 4, borderRadius: 6 },
    title: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const, lineHeight: 20 },
    body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
    muted: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    strong: { color: colors.accent, fontSize: 13, fontWeight: "600" as const, lineHeight: 19 },
    link: { color: colors.accent, textDecorationLine: "underline" as const },
    // File paths read like the chat file links: accent text, no underline.
    path: { color: colors.accent, fontFamily: "monospace", fontSize: 13 },
    url: { color: colors.accent, fontSize: 13, textDecorationLine: "underline" as const },
    pill,
    pillText: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const },
    pillAccent: { ...pill, borderColor: colors.accent },
    pillAccentText: { color: colors.accent, fontSize: 11, fontWeight: "600" as const },
    section: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingTop: 4,
    },
    sectionLabel: {
      color: colors.foregroundMuted,
      fontSize: 12,
      fontWeight: "600" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
    },
    sectionCount: { color: colors.foregroundMuted, fontSize: 12 },
    reply: {
      gap: 2,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
    },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
    action: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
    actionAccent: { color: colors.accent, fontSize: 12, fontWeight: "600" as const },
    banner: {
      gap: 8,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.surface0,
    },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: colors.accent,
    },
    buttonText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surface2,
      overflow: "hidden" as const,
    },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
    stats: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    percent: { color: colors.foreground, fontSize: 24, fontWeight: "700" as const },
  };
}

export type Styles = ReturnType<typeof createStyles>;
