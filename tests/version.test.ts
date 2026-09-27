import { describe, expect, it } from "vitest";
import { versionLabel } from "../src/version";

describe("Versionsanzeige", () => {
  it("nennt Commit und Tag des Releases, lokal einen lokalen Build", () => {
    expect(versionLabel("", "")).toBe("lokaler Build");
    expect(versionLabel("5b568e1f00c0ffee", "2026-09-27T22:30:00Z")).toBe("Version 5b568e1 vom 28. September 2026");
    expect(versionLabel("5b568e1f00c0ffee", "kaputt")).toBe("Version 5b568e1");
  });
});
