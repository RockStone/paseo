import { useEffect, useMemo, useRef } from "react";
import type { FileMediaPreviewProps } from "./types";

const videoStyle = {
  width: "100%",
  maxHeight: "100%",
  minHeight: 0,
  objectFit: "contain",
} as const;
const audioStyle = { width: "100%", maxWidth: 520 } as const;

export function FileMediaPreview({
  url,
  kind,
  label,
  colorScheme,
  onReady,
  onError,
}: FileMediaPreviewProps) {
  const styles = useMemo(
    () => ({ video: { ...videoStyle, colorScheme }, audio: { ...audioStyle, colorScheme } }),
    [colorScheme],
  );
  const playerRef = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const player = playerRef.current;
    return () => player?.pause();
  }, []);
  const shared = {
    src: url,
    controls: true,
    autoPlay: false,
    preload: "metadata",
    "aria-label": label,
    onLoadedMetadata: onReady,
    onError,
    ref: (element: HTMLMediaElement | null) => {
      playerRef.current = element;
    },
  };
  return kind === "video" ? (
    <video {...shared} playsInline data-testid="file-video-preview" style={styles.video} />
  ) : (
    <audio {...shared} data-testid="file-audio-preview" style={styles.audio} />
  );
}
