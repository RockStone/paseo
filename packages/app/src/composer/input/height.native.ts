import { useMemo } from "react";
import type { ComposerHeightResult } from "./height.types";

interface ComposerHeightArgs {
  getText: () => string;
  textarea: unknown;
  minHeight: number;
  maxHeight: number;
  onRenderedLinesChange?: (lines: number) => void;
  presentationKey?: boolean;
}

export function useComposerHeight({
  minHeight,
  maxHeight,
}: ComposerHeightArgs): ComposerHeightResult {
  const style = useMemo(() => ({ minHeight, maxHeight }), [maxHeight, minHeight]);
  return { mode: "intrinsic", style, scrollEnabled: true };
}
