import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ViewportFitOptions, ViewportSize } from "./geometry";
import { ZoomableViewport } from "./index";
import type { ZoomableViewportAction } from "./types";

interface ZoomableImageProps {
  uri: string;
  accessibilityLabel?: string;
  actions?: ZoomableViewportAction[];
  contentSize?: ViewportSize;
  fit?: ViewportFitOptions;
  maxScale?: number;
  minScale?: number;
  onError?: () => void;
  onReady?: () => void;
  onPressOutsideContent?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  wheelActivation?: "always" | "modifier";
}

export function ZoomableImage({
  uri,
  accessibilityLabel,
  actions,
  contentSize,
  fit,
  maxScale,
  minScale = 1,
  onError,
  onReady,
  onPressOutsideContent,
  style,
  testID = "zoomable-image",
  wheelActivation = "always",
}: ZoomableImageProps) {
  const [loadedSize, setLoadedSize] = useState<{ uri: string; size: ViewportSize } | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const [readyViewport, setReadyViewport] = useState<string | null>(null);
  const resolvedSize = contentSize ?? (loadedSize?.uri === uri ? loadedSize.size : null);
  const handleLoad = useCallback(() => setLoadedImage(uri), [uri]);
  const handleViewportReady = useCallback(() => setReadyViewport(uri), [uri]);
  useEffect(() => {
    if (loadedImage === uri && readyViewport === uri) onReady?.();
  }, [loadedImage, readyViewport, uri, onReady]);
  const source = useMemo(() => ({ uri }), [uri]);

  useEffect(() => {
    if (contentSize) return;
    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (!active) return;
        if (width > 0 && height > 0) setLoadedSize({ uri, size: { width, height } });
        else onError?.();
      },
      () => {
        if (active) onError?.();
      },
    );
    return () => {
      active = false;
    };
  }, [contentSize, onError, uri]);

  if (!resolvedSize) return <View style={[styles.root, style]} testID={testID} />;

  return (
    <ZoomableViewport
      key={uri}
      onReady={handleViewportReady}
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      contentSize={resolvedSize}
      fit={fit}
      maxScale={maxScale}
      minScale={minScale}
      onPressOutsideContent={onPressOutsideContent}
      style={style}
      testID={testID}
      wheelActivation={wheelActivation}
    >
      <Image
        onError={onError}
        onLoad={handleLoad}
        resizeMode="contain"
        source={source}
        style={styles.image}
        testID={`${testID}-image`}
      />
    </ZoomableViewport>
  );
}

const styles = StyleSheet.create(() => ({
  root: { flex: 1, minHeight: 0 },
  image: { width: "100%", height: "100%" },
}));
