// Paseoi: the native viewport's reading rows, from LegendList's viewability callback.
// The web viewport measures row geometry itself (`reading-anchor.ts`); LegendList already knows
// which rows are on screen, so native reads them from its `onViewableItemsChanged`.

/** A row counts as read once all of it is on screen. */
export const NATIVE_ROW_VISIBLE_PERCENT = 100;

interface ViewableRow {
  index: number;
  item: { id: string };
}

export interface NativeReadingRows {
  /** The first row fully on screen. */
  topRowId: string;
  /** The last row fully on screen: the furthest row the reader has seen whole. */
  readThroughRowId: string;
}

export function nativeReadingRows(viewable: readonly ViewableRow[]): NativeReadingRows | null {
  let first: ViewableRow | null = null;
  let last: ViewableRow | null = null;
  for (const row of viewable) {
    if (first === null || row.index < first.index) first = row;
    if (last === null || row.index > last.index) last = row;
  }
  if (first === null || last === null) return null;
  return { topRowId: first.item.id, readThroughRowId: last.item.id };
}

/**
 * Reports a reading row only when it changes, so a scroll that stays inside a row does not
 * reach the stream view.
 */
export function createReadingRowReporter(input: {
  onReadingPositionChange: (rowId: string | null) => void;
  onReadThroughChange: (rowId: string | null) => void;
}) {
  let topRowId: string | null | undefined;
  let readThroughRowId: string | null | undefined;
  return {
    report(rows: NativeReadingRows | null): void {
      const nextTop = rows?.topRowId ?? null;
      const nextReadThrough = rows?.readThroughRowId ?? null;
      if (nextTop !== topRowId) {
        topRowId = nextTop;
        input.onReadingPositionChange(nextTop);
      }
      if (nextReadThrough !== readThroughRowId) {
        readThroughRowId = nextReadThrough;
        input.onReadThroughChange(nextReadThrough);
      }
    },
    reset(): void {
      topRowId = undefined;
      readThroughRowId = undefined;
    },
  };
}
