import { createContext, useContext } from "react";

/** What the dock tells the composer it holds about the space they share. */
export interface ComposerSurface {
  /** The dock's measured height, which is the pane's chat area; undefined before layout. */
  height: number | undefined;
  /** This dock can place the composer beside its content. */
  splitAvailable: boolean;
  /** The composer sits beside the content and fills the dock's height. */
  split: boolean;
}

const DEFAULT_SURFACE: ComposerSurface = {
  height: undefined,
  splitAvailable: false,
  split: false,
};

export const ComposerSurfaceContext = createContext<ComposerSurface>(DEFAULT_SURFACE);

export function useComposerSurface(): ComposerSurface {
  return useContext(ComposerSurfaceContext);
}
