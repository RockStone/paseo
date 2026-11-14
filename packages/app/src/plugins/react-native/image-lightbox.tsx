import { useCallback, useMemo } from "react";
import type { ImageLightboxProps } from "@getpaseo/plugin/client/ui";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";

export function ImageLightbox({ sources, index, onIndexChange, onClose }: ImageLightboxProps) {
  const items = useMemo<ImageLightboxSource[]>(
    () => sources.map((source) => ({ type: "uri", uri: source.uri })),
    [sources],
  );
  const onNavigate = useCallback(
    (next: ImageLightboxSource) => {
      if (!onIndexChange) return;
      const nextIndex = items.indexOf(next);
      if (nextIndex >= 0) onIndexChange(nextIndex);
    },
    [items, onIndexChange],
  );
  return (
    <AttachmentLightbox
      source={items[index] ?? null}
      sources={items}
      onNavigate={onIndexChange ? onNavigate : undefined}
      onClose={onClose}
    />
  );
}
