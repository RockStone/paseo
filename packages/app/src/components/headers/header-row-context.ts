import { createContext, useContext, type RefObject } from "react";
import type { View } from "react-native";

/**
 * The header row a control sits in. A surface that hangs below the whole row rather than below
 * its trigger (Paseoi's right-edge plugin drawer) measures this. The screen header and the
 * workspace tab row provide it; a control outside both reads null.
 */
const HeaderRowContext = createContext<RefObject<View | null> | null>(null);

export const HeaderRowProvider = HeaderRowContext.Provider;

export function useHeaderRowRef(): RefObject<View | null> | null {
  return useContext(HeaderRowContext);
}
