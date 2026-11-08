import { describe, expect, it } from "vitest";
import { didYouMean, distance } from "@/lib/search/did-you-mean";

describe("didYouMean", () => {
  it("fixes a typo in a place or a kind of event", () => {
    expect(didYouMean("lisbn")).toBe("lisbon");
    expect(didYouMean("barcelonna")).toBe("barcelona");
    expect(didYouMean("jazz in lisbn")).toBe("jazz in lisbon");
  });
  it("leaves alone what it can't place", () => {
    expect(didYouMean("lisbon")).toBeUndefined();
    expect(didYouMean("zzqx")).toBeUndefined();
    expect(didYouMean("rock")).toBeUndefined();
  });
  it("counts swapped letters as one change", () => {
    expect(distance("lsibon", "lisbon")).toBe(1);
    expect(distance("paris", "parsi")).toBe(1);
  });
});
