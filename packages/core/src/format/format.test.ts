import { describe, expect, test } from "bun:test";
import { addr } from "../testing/ids";
import {
  formatAddress, formatCount, formatCutIndex, formatDuration, formatFee, formatGas, formatKeys, formatProblemSummary,
  formatSelector, formatStamp, formatTime, plural,
} from "./format";

describe("formatSelector", () => {
  test("full: signature backticked, hex bare", () => {
    expect(formatSelector({ hex: "0xa9059cbb", signature: "transfer(address,uint256)" })).toBe("`transfer(address,uint256)` 0xa9059cbb");
  });

  test("dense: the whole span backticked, function name only", () => {
    expect(formatSelector({ hex: "0xa9059cbb", signature: "transfer(address,uint256)" }, "dense")).toBe("`transfer · 0xa9059cbb`");
  });

  test("console example: sendMessage", () => {
    expect(formatSelector({ hex: "0xcdfe7f5c", signature: "sendMessage(bytes,bytes,bytes[])" }, "dense")).toBe("`sendMessage · 0xcdfe7f5c`");
  });
});

describe("formatAddress", () => {
  const address = addr(1);

  test("truncated 6 + 4 by default", () => {
    expect(formatAddress("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")).toBe("0x71C7…976F");
  });

  test("ENS name first when known", () => {
    expect(formatAddress(address, { ens: "vitalik.eth" })).toBe("vitalik.eth");
  });

  test("full: checksummed in full, or ens plus the full address", () => {
    expect(formatAddress("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", { full: true })).toBe("0x71C7656EC7ab88b098defB751B7401B5f6d8976F");
    expect(formatAddress("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", { full: true, ens: "vitalik.eth" })).toBe(
      "vitalik.eth (0x71C7656EC7ab88b098defB751B7401B5f6d8976F)",
    );
  });

  test("lowercase input is checksummed", () => {
    expect(formatAddress("0x71c7656ec7ab88b098defb751b7401b5f6d8976f", { full: true })).toBe("0x71C7656EC7ab88b098defB751B7401B5f6d8976F");
  });
});

describe("formatCount", () => {
  test("routed/exported, plural agrees with exported", () => {
    expect(formatCount(12, 17)).toBe("12/17 selectors");
    expect(formatCount(1, 1)).toBe("1/1 selector");
    expect(formatCount(0, 0)).toBe("0/0 selectors");
  });
});

describe("formatGas", () => {
  test("about, M abbreviation", () => {
    expect(formatGas(2_400_000n)).toBe("about 2.4M gas");
    expect(formatGas(0n)).toBe("about 0 gas");
    expect(formatGas(500_000n)).toBe("about 500K gas");
  });
});

describe("formatFee", () => {
  test("4 significant figures, native token, no fiat", () => {
    expect(formatFee(12_000_000_000_000_000n, "ETH")).toBe("0.012 ETH");
    expect(formatFee(4_000_000_000_000_000n, "ETH")).toBe("0.004 ETH");
    expect(formatFee(0n, "ETH")).toBe("0 ETH");
    expect(formatFee(1_000_000_000_000_000_000n, "ETH")).toBe("1 ETH");
  });

  test("decimals other than 18", () => {
    expect(formatFee(1_234_560n, "USDC", 6)).toBe("1.235 USDC");
  });
});

describe("formatDuration", () => {
  test("largest exact unit, both sides shown", () => {
    expect(formatDuration(300)).toBe("5 minutes (300 s)");
    expect(formatDuration(60)).toBe("1 minute (60 s)");
    expect(formatDuration(3600)).toBe("1 hour (3600 s)");
    expect(formatDuration(7200)).toBe("2 hours (7200 s)");
    expect(formatDuration(86400)).toBe("1 day (86400 s)");
    expect(formatDuration(0)).toBe("0 seconds (0 s)");
    expect(formatDuration(1)).toBe("1 second (1 s)");
    expect(formatDuration(90)).toBe("90 seconds (90 s)");
  });

  test("accepts a string", () => {
    expect(formatDuration("600")).toBe("10 minutes (600 s)");
  });
});

describe("formatTime", () => {
  test("relative buckets", () => {
    const now = "2026-09-23T12:00:00.000Z";
    expect(formatTime("2026-09-23T12:00:00.000Z", now).text).toBe("just now");
    expect(formatTime("2026-09-23T11:58:00.000Z", now).text).toBe("2 min ago");
    expect(formatTime("2026-09-23T10:00:00.000Z", now).text).toBe("2 hours ago");
    expect(formatTime("2026-09-22T12:00:00.000Z", now).text).toBe("1 day ago");
  });

  test("title is a deterministic absolute string, independent of host timezone", () => {
    expect(formatTime("2026-09-23T14:32:00.000Z", "2026-09-23T14:32:00.000Z").title).toBe("Sep 23, 2026, 14:32 UTC");
  });
});

describe("formatKeys", () => {
  test("mac: symbols, no separators, fixed modifier order", () => {
    expect(formatKeys("Mod+K", "mac")).toBe("⌘K");
    expect(formatKeys("Mod+Shift+Z", "mac")).toBe("⇧⌘Z");
    expect(formatKeys("Mod+Enter", "mac")).toBe("⌘⏎");
  });

  test("other: labels, plus-joined", () => {
    expect(formatKeys("Mod+K", "other")).toBe("Ctrl+K");
    expect(formatKeys("Mod+Shift+Z", "other")).toBe("Ctrl+Shift+Z");
  });

  test("bare keys pass through unchanged", () => {
    expect(formatKeys("F8", "mac")).toBe("F8");
    expect(formatKeys("F8", "other")).toBe("F8");
  });
});

describe("plural", () => {
  test("1 selector, 2 selectors, a given many-form, grouped counts", () => {
    expect(plural(1, "selector")).toBe("1 selector");
    expect(plural(2, "selector")).toBe("2 selectors");
    expect(plural(0, "selector")).toBe("0 selectors");
    expect(plural(1, "address", "addresses")).toBe("1 address");
    expect(plural(2, "address", "addresses")).toBe("2 addresses");
    expect(plural(1234, "facet")).toBe("1,234 facets");
  });
});

describe("formatCutIndex", () => {
  test("two digits, zero-based, grows past 99", () => {
    expect(formatCutIndex(0)).toBe("[00]");
    expect(formatCutIndex(3)).toBe("[03]");
    expect(formatCutIndex(99)).toBe("[99]");
    expect(formatCutIndex(100)).toBe("[100]");
  });
});

describe("formatStamp", () => {
  test("the spec's five stamps, word for word", () => {
    expect(formatStamp({ state: "not-deployed" })).toBe("Not deployed");
    expect(formatStamp({ state: "proposed", chain: "Sepolia" })).toBe("Proposed · Sepolia (Safe)");
    expect(formatStamp({ state: "live", chain: "Sepolia", revision: 1 })).toBe("Live · Sepolia · r1");
    expect(formatStamp({ state: "modified", revision: 1 })).toBe("Modified since r1");
    expect(formatStamp({ state: "mismatch", chain: "Sepolia" })).toBe("Mismatch · Sepolia");
  });
});

describe("formatProblemSummary", () => {
  test("the spec's chip text", () => {
    expect(formatProblemSummary({ blockers: 0, warnings: 0 })).toBe("No problems");
    expect(formatProblemSummary({ blockers: 2, warnings: 0 })).toBe("2 blockers");
    expect(formatProblemSummary({ blockers: 2, warnings: 1 })).toBe("2 blockers · 1 warning");
    expect(formatProblemSummary({ blockers: 0, warnings: 1 })).toBe("1 warning");
    expect(formatProblemSummary({ blockers: 1, warnings: 2 })).toBe("1 blocker · 2 warnings");
  });
});
