import { describe, expect, it } from "vitest";
import { toLatinDigits } from "./use-date-locale";

describe("toLatinDigits", () => {
  it("converts Devanagari digits and leaves other text alone", () => {
    expect(toLatinDigits("१६ मिनट")).toBe("16 मिनट");
    expect(toLatinDigits("लगभग २ घंटे")).toBe("लगभग 2 घंटे");
    expect(toLatinDigits("5 minutes")).toBe("5 minutes");
  });
});
