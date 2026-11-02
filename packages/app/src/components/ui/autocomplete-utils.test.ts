import { describe, expect, it } from "vitest";

import {
  getAutocompleteFallbackIndex,
  orderAutocompleteOptions,
  resolveInsideAutocompleteLayout,
} from "./autocomplete-utils";

const OPTIONS = ["alpha", "beta", "gamma"];

describe("orderAutocompleteOptions", () => {
  it("keeps first logical option closest to the input by default", () => {
    expect(orderAutocompleteOptions(OPTIONS)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("keeps normal top-down order when below-input is selected", () => {
    expect(orderAutocompleteOptions(OPTIONS, "below-input")).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("getAutocompleteFallbackIndex", () => {
  it("picks the option nearest the input by default", () => {
    expect(getAutocompleteFallbackIndex(3)).toBe(2);
    expect(getAutocompleteFallbackIndex(0)).toBe(-1);
  });

  it("picks top item when below-input ordering is used", () => {
    expect(getAutocompleteFallbackIndex(3, "below-input")).toBe(0);
  });
});

describe("resolveInsideAutocompleteLayout", () => {
  const editor = { top: 100, bottom: 900 };

  it("floats at the bottom of the editor, short of the caret line, while the caret is in the top half", () => {
    expect(
      resolveInsideAutocompleteLayout({ editor, caret: { top: 120, bottom: 140 }, offset: 12 }),
    ).toEqual({ edge: "bottom", maxHeight: 736 });
  });

  it("floats at the top of the editor, short of the caret line, while the caret is in the bottom half", () => {
    expect(
      resolveInsideAutocompleteLayout({ editor, caret: { top: 600, bottom: 620 }, offset: 12 }),
    ).toEqual({ edge: "top", maxHeight: 476 });
  });

  it("keeps to the top half without a caret", () => {
    expect(resolveInsideAutocompleteLayout({ editor, caret: null, offset: 12 })).toEqual({
      edge: "top",
      maxHeight: 400,
    });
  });
});
