import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import type { Theme } from "@/styles/theme";

const ATTACHMENT_CONTENT_HEIGHT = 48;
const IMAGE_PREVIEW_SIZE = 120;

interface AttachmentPillProps {
  onOpen: () => void;
  onRemove: () => void;
  openAccessibilityLabel: string;
  removeAccessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
  variant?: "default" | "image";
  children: ReactNode;
}

export function AttachmentPill({
  onOpen,
  onRemove,
  openAccessibilityLabel,
  removeAccessibilityLabel,
  disabled = false,
  testID,
  variant = "default",
  children,
}: AttachmentPillProps) {
  const isCompact = useIsCompactFormFactor();
  const [isBodyHovered, setIsBodyHovered] = useState(false);
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const isImage = variant === "image";
  const alwaysShow = isImage || isNative || isCompact;
  const showRemove = alwaysShow || isBodyHovered || isCloseHovered;
  const closeButtonStyle = useMemo(
    () => [
      styles.closeButton,
      isImage ? styles.imageCloseButton : styles.labelCloseButton,
      !showRemove && styles.closeButtonHidden,
    ],
    [isImage, showRemove],
  );
  const closeIconColor = isImage ? iconForegroundMapping : iconForegroundMutedMapping;
  const closeIconSize = isImage ? 16 : 12;
  const handleBodyHoverIn = useCallback(() => setIsBodyHovered(true), []);
  const handleBodyHoverOut = useCallback(() => setIsBodyHovered(false), []);
  const handleCloseHoverIn = useCallback(() => setIsCloseHovered(true), []);
  const handleCloseHoverOut = useCallback(() => setIsCloseHovered(false), []);
  return (
    <View style={styles.wrapper}>
      <Pressable
        testID={testID}
        onPress={onOpen}
        disabled={disabled}
        onHoverIn={handleBodyHoverIn}
        onHoverOut={handleBodyHoverOut}
        accessibilityRole="button"
        accessibilityLabel={openAccessibilityLabel}
        style={styles.frame}
      >
        {children}
      </Pressable>
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        onHoverIn={handleCloseHoverIn}
        onHoverOut={handleCloseHoverOut}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={removeAccessibilityLabel}
        style={closeButtonStyle}
      >
        <ThemedX size={closeIconSize} uniProps={closeIconColor} />
      </Pressable>
    </View>
  );
}

interface AttachmentFrameProps {
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  children: ReactNode;
}

/** Bare attachment frame for read-only surfaces (sent messages) — no remove button. */
export function AttachmentFrame({
  onPress,
  accessibilityLabel,
  testID,
  children,
}: AttachmentFrameProps) {
  if (!onPress) {
    return (
      <View testID={testID} style={styles.frame}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.frame}
    >
      {children}
    </Pressable>
  );
}

interface AttachmentLabelProps {
  icon?: ReactNode;
  title: string;
  subtitle: string;
}

/** Two-line labelled pill body: attachment name over its type. */
export function AttachmentLabel({ icon, title, subtitle }: AttachmentLabelProps) {
  return (
    <View style={styles.labelBody}>
      {icon ? <View style={styles.labelIcon}>{icon}</View> : null}
      <View style={styles.labelTextColumn}>
        <Text style={styles.labelTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.labelSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

/** Square image preview pill body. */
export function AttachmentThumbnail({
  metadata,
  size = "small",
}: {
  metadata: AttachmentMetadata;
  size?: "small" | "large";
}) {
  const uri = useAttachmentPreviewUrl(metadata);
  const source = useMemo(() => ({ uri: uri ?? "" }), [uri]);
  const thumbnailStyle = useMemo(
    () => [styles.thumbnail, size === "large" && styles.largeThumbnail],
    [size],
  );
  const placeholderStyle = useMemo(
    () => [thumbnailStyle, styles.thumbnailPlaceholder],
    [thumbnailStyle],
  );
  if (!uri) {
    return <View style={placeholderStyle} />;
  }
  return <Image source={source} style={thumbnailStyle} resizeMode="cover" />;
}

const ThemedX = withUnistyles(X);
const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  wrapper: {
    position: "relative",
  },
  frame: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  labelBody: {
    height: ATTACHMENT_CONTENT_HEIGHT,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  labelIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  labelTextColumn: {
    minWidth: 0,
    flexShrink: 1,
  },
  labelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  labelSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  thumbnail: {
    width: ATTACHMENT_CONTENT_HEIGHT,
    height: ATTACHMENT_CONTENT_HEIGHT,
  },
  largeThumbnail: { width: IMAGE_PREVIEW_SIZE, height: IMAGE_PREVIEW_SIZE },
  thumbnailPlaceholder: {
    backgroundColor: theme.colors.surface1,
  },
  closeButton: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  labelCloseButton: { top: -8, left: -8 },
  imageCloseButton: { top: 6, right: 6 },
  closeButtonHidden: {
    opacity: 0,
    pointerEvents: "none",
  },
}));
