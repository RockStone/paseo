import { useEffect, useRef, useState } from "react";
import type { AttachmentMetadata } from "@/attachments/types";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";

interface AttachmentPreview {
  url: string | null;
  status: "loading" | "ready" | "error";
}

export function useAttachmentPreview(
  attachment: AttachmentMetadata | null | undefined,
): AttachmentPreview {
  const key = JSON.stringify([
    attachment?.id,
    attachment?.storageType,
    attachment?.storageKey,
    attachment?.mimeType,
  ]);
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;
  const [result, setResult] = useState<(AttachmentPreview & { key: string }) | null>(null);
  useEffect(() => {
    const current = attachmentRef.current;
    if (!current) return;
    let disposed = false;
    let currentUrl: string | null = null;
    void (async () => {
      try {
        const url = await resolveAttachmentPreviewUrl(current);
        if (disposed) {
          await releaseAttachmentPreviewUrl({ attachment: current, url });
          return;
        }
        currentUrl = url;
        setResult({ key, url, status: "ready" });
      } catch (error) {
        console.error("[attachments] Failed to resolve preview URL", {
          attachmentId: current.id,
          error,
        });
        if (!disposed) setResult({ key, url: null, status: "error" });
      }
    })();
    return () => {
      disposed = true;
      if (currentUrl) void releaseAttachmentPreviewUrl({ attachment: current, url: currentUrl });
    };
  }, [key]);
  if (!attachment) return { url: null, status: "ready" };
  return result?.key === key ? result : { url: null, status: "loading" };
}

export function useAttachmentPreviewUrl(
  attachment: AttachmentMetadata | null | undefined,
): string | null {
  return useAttachmentPreview(attachment).url;
}
