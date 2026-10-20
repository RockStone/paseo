import { describe, expect, it } from "vitest";
import { isCustomBuildVersion, stripCustomBuildVersion } from "./custom-build-version.js";

describe("Paseoi build versions", () => {
  it("recognizes only the Paseoi revision suffix", () => {
    expect(isCustomBuildVersion("0.12.0-paseoi.63")).toBe(true);
    expect(isCustomBuildVersion("0.12.0")).toBe(false);
    expect(isCustomBuildVersion("0.12.0-beta.3")).toBe(false);
  });

  it("compares a Paseoi app with its bundled daemon by the upstream version", () => {
    expect(stripCustomBuildVersion("0.12.0-paseoi.63")).toBe("0.12.0");
    expect(stripCustomBuildVersion("0.12.0-beta.3")).toBe("0.12.0-beta.3");
  });
});
