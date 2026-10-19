import React, { type ReactElement } from "react";
import { View } from "react-native";
import { markdownCopyImageSourcesDataSet } from "@/assistant-selection-copy/markup";
import { isWeb } from "@/constants/platform";

export function MarkdownRendererFrame({
  imageSources,
  children,
}: {
  imageSources: Record<string, string>;
  children: ReactElement;
  watchTables?: boolean;
  markdownSource?: string;
}) {
  return (
    <View dataSet={isWeb ? markdownCopyImageSourcesDataSet(imageSources) : undefined}>
      {children}
    </View>
  );
}
