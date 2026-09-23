import { describe, expect, test } from "bun:test";
import { lintCopy } from "./copy-lint";

describe("lintCopy", () => {
  test("please", () => {
    expect(lintCopy("Please try again.").map((i) => i.rule)).toEqual(["please"]);
  });

  test("oops", () => {
    expect(lintCopy("Oops, something went wrong.").map((i) => i.rule)).toEqual(["oops"]);
  });

  test("exclamation marks", () => {
    expect(lintCopy("Removed 2 facets!").map((i) => i.rule)).toEqual(["exclamation"]);
  });

  test("bare OK or Yes, case-insensitively, but not a longer string containing them", () => {
    expect(lintCopy("OK").map((i) => i.rule)).toEqual(["ok-yes"]);
    expect(lintCopy("Yes").map((i) => i.rule)).toEqual(["ok-yes"]);
    expect(lintCopy(" ok ").map((i) => i.rule)).toEqual(["ok-yes"]);
    expect(lintCopy("Yesterday").map((i) => i.rule)).toEqual([]);
    expect(lintCopy("OK, that works").map((i) => i.rule)).toEqual([]);
  });

  test("British spellings", () => {
    expect(lintCopy("Open the Catalogue").map((i) => i.rule)).toContain("british");
    expect(lintCopy("Pick a colour").map((i) => i.rule)).toContain("british");
    expect(lintCopy("Still initialising").map((i) => i.rule)).toContain("british");
    expect(lintCopy("Cancelled by the user").map((i) => i.rule)).toContain("british");
    expect(lintCopy("At the centre").map((i) => i.rule)).toContain("british");
    expect(lintCopy("Maximise the window").map((i) => i.rule)).toContain("british");
  });

  test("US spellings never flag", () => {
    expect(lintCopy("Catalog, color, initialize, canceled, center, maximize")).toEqual([]);
  });

  test("title case: a run of capitalized words including a common stopword", () => {
    expect(lintCopy("Deploy On The Live Diamond").map((i) => i.rule)).toEqual(["title-case"]);
  });

  test("sentence case never flags, including PascalCase facet and command names", () => {
    expect(lintCopy("Place DiamondLoupeFacet")).toEqual([]);
    expect(lintCopy("Use LatticeFactory")).toEqual([]);
    expect(lintCopy("Choose another chain")).toEqual([]);
    expect(lintCopy("Retry reading Sepolia")).toEqual([]);
    expect(lintCopy("Resolve 2 blockers · F8")).toEqual([]);
  });

  test("clean copy has no issues", () => {
    expect(lintCopy("ERC20Pausable cuts nothing: both its selectors are seams that GovernedVault serves. Remove it.")).toEqual([]);
  });

  test("match and index locate the offending text", () => {
    const [issue] = lintCopy("Please retry.");
    expect(issue?.match).toBe("Please");
    expect(issue?.index).toBe(0);
  });

  test("hex never reads as a run of capitalized words", () => {
    expect(lintCopy("Deployed at 0xA1B2c3D4e5F607182930A1B2c3D4e5F607182930 in block 1.")).toEqual([]);
    expect(lintCopy("The admin is 0x4B20…9eF1, an address this diamond had or a recorded deployment holds.")).toEqual([]);
  });

  test("Flow 14's recovery strings (spec L586-L606) are all clean", () => {
    const flow14 = [
      "No wallet found in this browser.",
      "Your wallet is on Base Sepolia.",
      "Needs about 0.012 ETH; this account has 0.004.",
      "Sepolia's public RPC isn't answering.",
      "Deployed, but `facets()` doesn't match the plan.",
      "Changed since review. Simulating again.",
      "Tab closed while pending",
      "Deploy needs a connection.",
      "Offline. Tracking resumes when you reconnect.",
      "Studio was updated. Save and reload to continue.",
    ];
    for (const text of flow14) expect(lintCopy(text)).toEqual([]);
  });
});
