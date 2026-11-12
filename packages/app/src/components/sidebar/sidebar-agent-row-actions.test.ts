import { describe, expect, it } from "vitest";
import { agentRowKebabVisible } from "./sidebar-agent-row-actions";

describe("agentRowKebabVisible", () => {
  it("hides the kebab for a mouse user until hover", () => {
    expect(
      agentRowKebabVisible({ hovered: false, controlsAlwaysVisible: false, menuOpen: false }),
    ).toBe(false);
    expect(
      agentRowKebabVisible({ hovered: true, controlsAlwaysVisible: false, menuOpen: false }),
    ).toBe(true);
  });

  it("shows the kebab without hover on touch, and while its menu is open", () => {
    expect(
      agentRowKebabVisible({ hovered: false, controlsAlwaysVisible: true, menuOpen: false }),
    ).toBe(true);
    expect(
      agentRowKebabVisible({ hovered: false, controlsAlwaysVisible: false, menuOpen: true }),
    ).toBe(true);
  });
});
