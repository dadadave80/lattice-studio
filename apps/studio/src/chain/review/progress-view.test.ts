import { describe, expect, test } from "bun:test";
import { elapsedText, matchesText, simulationReport, staleMinutes, staleText, timerText } from "./progress-view";

describe("the progress timer", () => {
  test("reads m:ss", () => {
    expect(timerText(12_000)).toBe("0:12");
    expect(timerText(65_400)).toBe("1:05");
    expect(timerText(3_600_000)).toBe("60:00");
    expect(timerText(-5_000)).toBe("0:00");
  });

  test("counts from an ISO time, or says nothing without one", () => {
    const since = "2026-01-01T00:00:00.000Z";
    expect(elapsedText(since, Date.parse(since) + 12_000)).toBe("0:12");
    expect(elapsedText(undefined, 0)).toBeNull();
    expect(elapsedText("not a time", 0)).toBeNull();
  });
});

describe("the stale sentence", () => {
  test("names the receipt timeout in minutes", () => {
    expect(staleMinutes(180)).toBe(3);
    expect(staleMinutes(90)).toBe(2);
    expect(staleMinutes(20)).toBe(1);
    expect(staleText(180)).toBe("Not seen for 3 minutes. It may have been dropped.");
    expect(staleText(60)).toBe("Not seen for 1 minute. It may have been dropped.");
  });
});

describe("the words", () => {
  test("a matching diamond", () => {
    expect(matchesText(14, 120)).toBe("Diamond matches the sheet: 14 facets, 120 selectors.");
    expect(matchesText(1, 1)).toBe("Diamond matches the sheet: 1 facet, 1 selector.");
  });

  test("a revert's report", () => {
    const report = simulationReport({
      revert: "Deploy reverted in LatticeRegistry: LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)",
      recipeHash: "0x3f2a",
      chainName: "Sepolia",
      chainId: 11155111,
      path: "LatticeFactory",
      catalog: "v0.4.0",
    });
    expect(report).toBe(
      [
        "Simulation reverted",
        "Deploy reverted in LatticeRegistry: LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)",
        "",
        "Recipe: 0x3f2a",
        "Chain: Sepolia (11155111)",
        "Path: LatticeFactory",
        "Catalog: v0.4.0",
      ].join("\n"),
    );
  });
});
