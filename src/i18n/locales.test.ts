import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("prefers a valid cookie", () => {
    expect(resolveLocale("hi", "en")).toBe("hi");
  });

  it("falls back to the deployment default for a missing or unknown cookie", () => {
    expect(resolveLocale(undefined, "es")).toBe("es");
    expect(resolveLocale("xx", "pt")).toBe("pt");
  });

  it("falls back to English when nothing is valid", () => {
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale("xx", "yy")).toBe("en");
  });
});

describe("LOCALES", () => {
  it("has a catalogue for every offered language", () => {
    for (const { code } of LOCALES) {
      expect(existsSync(join(process.cwd(), "messages", `${code}.json`))).toBe(true);
    }
  });
});
