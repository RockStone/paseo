import type { ReactElement } from "react";

/** Native has no table copy controls; the web frame adds them around the rendered blocks. */
export function MarkdownRendererFrame({
  children,
}: {
  children: ReactElement;
  watchTables?: boolean;
  markdownSource?: string;
}) {
  return children;
}
