import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { isNative, isWeb } from "@/constants/platform";
import { SPACING } from "@/styles/theme";
import { WindowChromeRootRegion } from "@/utils/desktop-window";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import type { ViewportSize } from "@/components/zoomable-viewport/geometry";
import { useGlobalWebOverlayLayer, useWebOverlayRegistration } from "@/lib/overlay-root";

export type ImageLightboxSource =
  | { type: "attachment"; metadata: AttachmentMetadata }
  | { type: "uri"; uri: string; contentSize?: ViewportSize };

interface AttachmentLightboxProps {
  source: ImageLightboxSource | null;
  onClose: () => void;
  sources?: readonly ImageLightboxSource[];
  onNavigate?: (source: ImageLightboxSource) => void;
}

const ModalRoot = isNative ? GestureHandlerRootView : View;
const LIGHTBOX_FIT = { padding: SPACING[4], maxWidth: 960, maxHeight: 640 };

function sourceKey(source: ImageLightboxSource): string {
  return source.type === "attachment" ? `attachment:${source.metadata.id}` : `uri:${source.uri}`;
}

export function AttachmentLightbox({
  source,
  onClose,
  sources,
  onNavigate,
}: AttachmentLightboxProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const index = source
    ? (sources?.findIndex((item) => sourceKey(item) === sourceKey(source)) ?? -1)
    : -1;
  const hasGallery = index >= 0 && (sources?.length ?? 0) > 1 && !!onNavigate;
  const navigate = useCallback(
    (offset: number) => {
      const next = sources?.[index + offset];
      if (hasGallery && next) onNavigate?.(next);
    },
    [sources, index, hasGallery, onNavigate],
  );
  const previous = useCallback(() => navigate(-1), [navigate]);
  const next = useCallback(() => navigate(1), [navigate]);
  const modalLayer = useGlobalWebOverlayLayer("modal", isWeb && source !== null);

  const handleWebOverlayKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (hasGallery && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        event.stopPropagation();
        navigate(event.key === "ArrowLeft" ? -1 : 1);
        return true;
      }
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return true;
    },
    [onClose, hasGallery, navigate],
  );
  const setWebOverlayScope = useWebOverlayRegistration({
    active: isWeb && source !== null,
    layer: modalLayer,
    onKeyDown: handleWebOverlayKeyDown,
  });

  const contentLayerStyle = useMemo(
    () => [
      styles.contentLayer,
      {
        paddingTop: insets.top,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      },
    ],
    [insets.bottom, insets.left, insets.right, insets.top],
  );
  if (!source) {
    return null;
  }

  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible onRequestClose={onClose}>
      <ModalRoot style={styles.root}>
        <WindowChromeRootRegion corners="both">
          <View ref={setWebOverlayScope} style={styles.root}>
            <Pressable
              testID="attachment-lightbox-backdrop"
              accessibilityRole="button"
              accessibilityLabel={t("message.attachments.dismissImage")}
              onPress={onClose}
              style={styles.backdrop}
            />
            <View pointerEvents="box-none" style={contentLayerStyle}>
              <View pointerEvents="box-none" style={styles.imageArea}>
                <LightboxImage key={sourceKey(source)} source={source} onClose={onClose} />
              </View>
              {hasGallery ? (
                <LightboxNavigation
                  index={index}
                  total={sources?.length ?? 0}
                  previous={previous}
                  next={next}
                />
              ) : null}
            </View>
          </View>
        </WindowChromeRootRegion>
      </ModalRoot>
    </Modal>
  );
}

function LightboxNavigation({
  index,
  total,
  previous,
  next,
}: {
  index: number;
  total: number;
  previous: () => void;
  next: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <View pointerEvents="box-none" style={styles.navigation}>
        <Pressable
          testID="attachment-lightbox-previous"
          accessibilityRole="button"
          accessibilityLabel={t("message.attachments.previousImage")}
          disabled={index === 0}
          onPress={previous}
          style={[styles.arrow, index === 0 && styles.disabled]}
        >
          <ChevronLeft size={24} color="#fff" />
        </Pressable>
        <Pressable
          testID="attachment-lightbox-next"
          accessibilityRole="button"
          accessibilityLabel={t("message.attachments.nextImage")}
          disabled={index === total - 1}
          onPress={next}
          style={[styles.arrow, index === total - 1 && styles.disabled]}
        >
          <ChevronRight size={24} color="#fff" />
        </Pressable>
      </View>
      <Text pointerEvents="none" testID="attachment-lightbox-position" style={styles.position}>
        {index + 1} / {total}
      </Text>
    </>
  );
}

function LightboxImage({
  source,
  onClose,
}: Pick<AttachmentLightboxProps, "onClose"> & { source: ImageLightboxSource }) {
  const { t } = useTranslation();
  const attachmentUrl = useAttachmentPreviewUrl(
    source.type === "attachment" ? source.metadata : null,
  );
  const url = source.type === "uri" ? source.uri : attachmentUrl;
  const [errored, setErrored] = useState(false);
  const actions = useMemo(
    () => [
      {
        icon: X,
        label: t("message.attachments.closeImage"),
        onPress: onClose,
        testID: "attachment-lightbox-close",
      },
    ],
    [onClose, t],
  );

  const handleImageError = useCallback(() => setErrored(true), []);

  if (errored || !url)
    return <Text style={styles.errorText}>{t("message.attachments.imageLoadFailed")}</Text>;
  return (
    <ZoomableImage
      accessibilityLabel={t("composer.attachments.openImage")}
      actions={actions}
      contentSize={source.type === "uri" ? source.contentSize : undefined}
      fit={LIGHTBOX_FIT}
      onError={handleImageError}
      onPressOutsideContent={onClose}
      style={styles.imageViewport}
      testID="attachment-lightbox"
      uri={url}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  contentLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imageViewport: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
  },
  navigation: {
    position: "absolute",
    top: "50%",
    left: SPACING[4],
    right: SPACING[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(64,64,64,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.25 },
  position: {
    position: "absolute",
    bottom: SPACING[4],
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#fff",
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
