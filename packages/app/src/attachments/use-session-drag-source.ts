import type { RefCallback } from "react";
import type { Text } from "react-native";
import type { SessionDragSourceInput } from "./session-drag";

export function useSessionDragSource(
  _input: SessionDragSourceInput,
): RefCallback<Text> | undefined {
  return undefined;
}
