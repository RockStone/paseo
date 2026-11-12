export function formatContextPercentage(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

// Paseoi: details with a pressable Refresh/Compact need a sheet wherever nobody can hover. Only a
// wide layout with a fine pointer gets the hover card.
export function meterPresentation(input: {
  isCompact: boolean;
  finePointer: boolean;
}): "sheet" | "hover-card" {
  return input.isCompact || !input.finePointer ? "sheet" : "hover-card";
}
