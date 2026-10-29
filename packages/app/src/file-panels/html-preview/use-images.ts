import { useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import {
  prepareHtmlPreviewImages,
  readHtmlPreviewImages,
  type HtmlPreviewImageAsset,
} from "./images";

export function useHtmlPreviewImages(input: {
  html: string;
  filePath: string;
  workspaceRoot: string;
  serverId: string;
  client: DaemonClient | null;
}) {
  const { html, filePath, workspaceRoot, serverId, client } = input;
  const document = useMemo(
    () => prepareHtmlPreviewImages(html, filePath, workspaceRoot),
    [html, filePath, workspaceRoot],
  );
  const query = useFetchQuery({
    queryKey: ["htmlPreviewImages", serverId, workspaceRoot, document.paths],
    dataShape: "value",
    enabled: client !== null && document.paths.length > 0,
    immutableWhen: () => true,
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("Host disconnected");
      return readHtmlPreviewImages(client, workspaceRoot, document.paths, signal);
    },
  });
  const images = query.data;
  const resolved = useMemo(() => {
    const urls = new Map<string, string>();
    const assets: HtmlPreviewImageAsset[] = [];
    for (const image of images ?? []) {
      if (image.status !== "ready") continue;
      const source = `data:,paseo-image-${assets.length}`;
      urls.set(image.path, source);
      assets.push({ source, bytes: image.bytes, mime: image.mime });
    }
    return { html: document.render(urls), assets };
  }, [document, images]);
  const hasImages = document.paths.length > 0;
  const needsImages = hasImages && client !== null;
  const pending = needsImages && !query.isError && images === undefined;
  const failures =
    images?.flatMap((image) =>
      image.status === "error" ? [`${image.path}: ${image.message}`] : [],
    ) ?? [];
  if (query.isError) failures.push(query.error.message);
  if (hasImages && client === null && images === undefined) failures.push("Host disconnected");
  return {
    html: pending ? null : resolved.html,
    images: resolved.assets,
    failures,
    retrying: query.isFetching,
    retry: () => void query.refetch(),
  };
}
