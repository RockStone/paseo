import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Pressable, Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { darkClaudeTheme } from "@/styles/theme";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  useBottomSheetModalInternal: () => null,
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));

vi.mock("@/components/ui/floating", () => ({
  FloatingSurface: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
}));

vi.mock("react-native-unistyles", async () => {
  const { darkClaudeTheme: mockTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: (styles: unknown) => (typeof styles === "function" ? styles(mockTheme) : styles),
    },
  };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderTrigger({
  childDisabled,
  onPress,
}: {
  childDisabled: boolean;
  onPress: () => void;
}): void {
  act(() => {
    root?.render(
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable disabled={childDisabled} onPress={onPress} testID="trigger">
            <Text>Send</Text>
          </Pressable>
        </TooltipTrigger>
      </Tooltip>,
    );
  });
}

function pressTrigger(): void {
  const trigger = container?.querySelector('[data-testid="trigger"]');
  expect(trigger).not.toBeNull();

  act(() => {
    trigger?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

describe("TooltipTrigger", () => {
  it("keeps an asChild trigger disabled when the child is disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: true, onPress });
    pressTrigger();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("keeps an asChild trigger interactive when the child is not disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: false, onPress });
    pressTrigger();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

const customLabelStyle = { color: "rgb(10, 20, 30)" };
const richLabelStyle = { color: "rgb(40, 50, 60)" };

it("uses primary theme text for plain tooltip labels while preserving styled and rich content", () => {
  act(() => {
    root?.render(
      <Tooltip open>
        <TooltipContent>
          {"Plain label"}
          <Text testID="unstyled-label">Text label</Text>
          <Text testID="styled-label" style={customLabelStyle}>
            Custom label
          </Text>
          <View testID="rich-label">
            <Text style={richLabelStyle}>Rich content</Text>
          </View>
        </TooltipContent>
      </Tooltip>,
    );
  });
  const expected = document.createElement("span");
  expected.style.color = darkClaudeTheme.colors.foreground;
  expect(document.querySelector('[data-testid="unstyled-label"]')?.getAttribute("style")).toContain(
    `color: ${expected.style.color}`,
  );
  expect(document.body.textContent).toContain("Plain label");
  expect(document.querySelector('[data-testid="styled-label"]')?.getAttribute("style")).toContain(
    "color: rgb(10, 20, 30)",
  );
  expect(document.querySelector('[data-testid="rich-label"]')?.textContent).toBe("Rich content");
});
