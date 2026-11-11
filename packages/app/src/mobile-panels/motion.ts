import { Easing } from "react-native-reanimated";

/**
 * How a sidebar slides in and out: the compact left and right panels, and Paseoi's right-edge
 * plugin drawer on wide layouts, which should feel like the same motion.
 */
export const PANEL_SLIDE_DURATION_MS = 220;
export const PANEL_SLIDE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
