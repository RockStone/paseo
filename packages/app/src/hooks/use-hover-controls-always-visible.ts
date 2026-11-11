import { useIsCompactFormFactor } from "@/constants/layout";
import { usePointerCapabilities } from "@/hooks/pointer-capabilities";

// Controls revealed on hover need another path wherever nobody can hover: native, compact
// layouts, and touch tablets running the desktop web layout (an iPad in Safari). The fine-pointer
// media query is the only signal that covers the last case; native already reports no fine
// pointer. A hybrid laptop with a mouse and a touch screen keeps the hover reveal.
export function hoverControlsAlwaysVisible(input: {
  finePointer: boolean;
  isCompact: boolean;
}): boolean {
  return !input.finePointer || input.isCompact;
}

/** True when hover-revealed controls must render without hover. Use as `isHovered || this`. */
export function useHoverControlsAlwaysVisible(): boolean {
  const { finePointer } = usePointerCapabilities();
  const isCompact = useIsCompactFormFactor();
  return hoverControlsAlwaysVisible({ finePointer, isCompact });
}
