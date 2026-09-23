import { afterEach, describe, expect, test } from "bun:test";
import type { ConsoleLine, Problem } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { scriptChainIds } from "./chains";
import { filterEntries, isFiltering, matchesQuery, parseQuery, showingText } from "./filter";
import { findOnSheet, findSummary, firstAnchor, foundFacets } from "./find";
import { changedLines } from "./line-diff";
import {
  appendLine, clearLog, flushLogPersistence, LOG_CAP, LOG_STORAGE_KEY, logEntries, resetConsoleLog, restoreLog, setKeepLog,
  setLogStorage, type LogEntry, type LogStorage,
} from "./log-store";
import { NO_PROBLEMS, problemLines } from "./problem-lines";
import { completion, editDistance, nearestVerb, type VerbWords } from "./suggest";
import { consoleSummary, EMPTY_SUMMARY, LIVE_SUMMARY, MISMATCH_SUMMARY, OFFLINE_SUMMARY, type SummaryInput } from "./summary";

const at = "2026-09-23T12:00:00.000Z";
const line = (text: string, extra: Partial<ConsoleLine> = {}): ConsoleLine => ({ tag: "Note", text, at, ...extra });

afterEach(() => resetConsoleLog());

describe("log store", () => {
  test("consecutive repeats collapse to one entry with a count; a different line starts a new one", () => {
    appendLine(line("Tidied 4 facets."));
    appendLine(line("Tidied 4 facets.", { at: "2026-09-23T12:00:05.000Z" }));
    appendLine(line("Tidied 4 facets."));
    appendLine(line("Tidied 4 facets.", { dim: true }));
    appendLine(line("Tidied 4 facets."));
    const entries = logEntries();
    expect(entries.map((e) => [e.text, e.count, e.dim ?? false])).toEqual([
      ["Tidied 4 facets.", 3, false],
      ["Tidied 4 facets.", 1, true],
      ["Tidied 4 facets.", 1, false],
    ]);
  });

  test("lines with different anchors don't collapse", () => {
    appendLine(line("x", { anchor: { kind: "facet", facet: "ERC20" } }));
    appendLine(line("x", { anchor: { kind: "facet", facet: "ERC4626" } }));
    expect(logEntries()).toHaveLength(2);
  });

  test("keeps at most LOG_CAP entries, dropping the oldest", () => {
    for (let i = 0; i < LOG_CAP + 5; i += 1) appendLine(line(`line ${i}`));
    expect(logEntries()).toHaveLength(LOG_CAP);
    expect(logEntries()[0]?.text).toBe("line 5");
    clearLog();
    expect(logEntries()).toEqual([]);
  });

  test("Keep log across reloads writes the log and restores it before new lines, validating every field", () => {
    const store = new Map<string, string>();
    const storage: LogStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    setLogStorage(storage);
    setKeepLog(true);
    appendLine(line("Placed ERC20 · 9 selectors", { tag: "Placed", anchor: { kind: "facet", facet: "ERC20" } }));
    appendLine(line("Placed ERC20 · 9 selectors", { tag: "Placed", anchor: { kind: "facet", facet: "ERC20" } }));
    flushLogPersistence();
    const saved = JSON.parse(store.get(LOG_STORAGE_KEY) ?? "[]") as unknown[];
    expect(saved).toHaveLength(1);

    // A hostile or damaged entry is dropped; the good ones come back first, with their counts.
    store.set(LOG_STORAGE_KEY, JSON.stringify([...saved, { tag: "Evil", text: "x", at }, { tag: "Note", text: 5, at }, "junk"]));
    resetConsoleLog();
    setLogStorage(storage);
    setKeepLog(true);
    appendLine(line("New this start"));
    expect(restoreLog()).toBe(1);
    expect(logEntries().map((e) => [e.tag, e.text, e.count])).toEqual([
      ["Placed", "Placed ERC20 · 9 selectors", 2],
      ["Note", "New this start", 1],
    ]);
    expect(logEntries()[0]?.anchor).toEqual({ kind: "facet", facet: "ERC20" });

    setKeepLog(false);
    expect(store.has(LOG_STORAGE_KEY)).toBe(false);
  });
});

describe("filter", () => {
  const entries: LogEntry[] = [
    { ...line("Placed ERC20 · 9 selectors"), tag: "Placed", id: 1, count: 1 },
    { ...line("AxelarGatewayAdapter and HyperlaneGatewayAdapter both export `sendMessage · 0xcdfe7f5c`."), tag: "Collision", id: 2, count: 1 },
    { ...line("Tidied 4 facets."), id: 3, count: 1 },
    { ...line("Deploy reverted in LatticeRegistry"), tag: "Error", id: 4, count: 2 },
  ];

  test("text words must all match, -words must not, case-insensitively", () => {
    expect(filterEntries(entries, { tags: new Set(), query: "erc20" }).map((e) => e.id)).toEqual([1]);
    expect(filterEntries(entries, { tags: new Set(), query: "a -tidied -erc20" }).map((e) => e.id)).toEqual([2, 4]);
    expect(filterEntries(entries, { tags: new Set(), query: "collision 0xcdfe" }).map((e) => e.id)).toEqual([2]);
  });

  test("/regex/ with flags; an invalid pattern matches as text", () => {
    expect(filterEntries(entries, { tags: new Set(), query: "/^(Placed|Error) /" }).map((e) => e.id)).toEqual([1, 4]);
    expect(parseQuery("/0x[0-9a-f]{8}/").kind).toBe("regex");
    expect(parseQuery("/(unclosed/")).toEqual({ kind: "words", include: ["/(unclosed/"], exclude: [] });
    expect(matchesQuery({ tag: "Note", text: "see /(unclosed/ here" }, parseQuery("/(unclosed/"))).toBe(true);
  });

  test("tag chips narrow to the pressed tags; none pressed shows every tag", () => {
    expect(filterEntries(entries, { tags: new Set(["Collision", "Error"]), query: "" }).map((e) => e.id)).toEqual([2, 4]);
    expect(isFiltering({ tags: new Set(), query: " " })).toBe(false);
    expect(isFiltering({ tags: new Set(["Note"]), query: "" })).toBe(true);
    expect(showingText(2, 4)).toBe("Showing 2 of 4");
  });
});

describe("suggestions", () => {
  const verbs: VerbWords[] = [
    { verb: "place", aliases: ["add"], subs: [] },
    { verb: "remove", aliases: ["rm"], subs: [] },
    { verb: "route", aliases: [], subs: [] },
    { verb: "export", aliases: [], subs: ["foundry", "brief", "json", "safe", "project"] },
    { verb: "problems", aliases: [], subs: [] },
  ];

  test("the nearest verb: a prefix, then the fewest edits, never a far one", () => {
    expect(editDistance("plcae", "place")).toBe(1);
    expect(nearestVerb("plce", verbs)).toBe("place");
    expect(nearestVerb("expotr", verbs)).toBe("export");
    expect(nearestVerb("prob", verbs)).toBe("problems");
    expect(nearestVerb("ad", verbs)).toBe("place");
    expect(nearestVerb("zzzzzz", verbs)).toBeNull();
  });

  test("Tab completes the verb, then a verb's fixed word", () => {
    expect(completion("pl", verbs)).toBe("place");
    expect(completion("export f", verbs)).toBe("export foundry");
    expect(completion("export  j", verbs)).toBe("export  json");
    expect(completion("place", verbs)).toBeNull();
    expect(completion("place erc", verbs)).toBeNull();
    expect(completion("", verbs)).toBeNull();
  });
});

describe("change marks", () => {
  test("lines new or changed since the previous text", () => {
    expect([...changedLines(["a", "b", "c"], ["a", "x", "b", "c", "d"])]).toEqual([1, 4]);
    expect([...changedLines(["a", "b"], ["a", "c"])]).toEqual([1]);
    expect([...changedLines([], ["a"])]).toEqual([0]);
    expect([...changedLines(["a"], ["a"])]).toEqual([]);
  });
});

describe("find", () => {
  const catalog = loadFixtureCatalog();
  if (!catalog.ok) throw new Error(catalog.error);
  const placed = ["ERC20", "ERC4626", "AxelarGatewayAdapter"];

  test("names and signatures match by substring; hex by prefix; only placed facets", () => {
    const byName = findOnSheet("erc20", placed, catalog.value);
    expect(byName.facets).toEqual(["ERC20"]);
    const byHex = findOnSheet("0x313ce567", placed, catalog.value);
    expect(byHex.facets).toEqual([]);
    expect(byHex.pins.map((p) => [p.facet, p.signature])).toEqual([
      ["ERC20", "decimals()"],
      ["ERC4626", "decimals()"],
    ]);
    expect(firstAnchor(byHex)).toEqual({ kind: "selector", selector: "0x313ce567", facet: "ERC20" });
    expect(foundFacets(byHex, placed)).toEqual(["ERC20", "ERC4626"]);
    expect(findSummary(byHex, placed)).toBe(
      "Found 2 pins matching ‘0x313ce567’: `decimals · 0x313ce567` on ERC20 and `decimals · 0x313ce567` on ERC4626. Selected ERC20 and ERC4626.",
    );
  });

  test("nothing matching says so", () => {
    const none = findOnSheet("zzz", placed, catalog.value);
    expect(firstAnchor(none)).toBeNull();
    expect(findSummary(none, placed)).toBe("Nothing on the sheet matches ‘zzz’.");
  });
});

describe("problems", () => {
  const problem = (code: Problem["code"], severity: Problem["severity"], message: string): Problem => ({
    id: `${code}:x`, code, severity, where: [{ kind: "facet", facet: "ERC20" }], params: {}, message, fixes: [],
  });

  test("a count, then each problem with its severity and code, anchored", () => {
    const out = problemLines([
      problem("SEL-01", "blocker", "`sendMessage(bytes)` 0xcdfe7f5c is exported by A and B. Choose one owner."),
      problem("INIT-05", "warning", "2 fields still use example values."),
      problem("STO-02", "info", "ERC20Votes shares `lattice.storage.ERC20` with ERC20."),
    ]);
    expect(out.map((l) => [l.tag, l.text])).toEqual([
      ["Note", "1 blocker · 1 warning · 1 info."],
      ["Collision", "Blocker · SEL-01 · `sendMessage(bytes)` 0xcdfe7f5c is exported by A and B. Choose one owner."],
      ["Init", "Warning · INIT-05 · 2 fields still use example values."],
      ["Note", "Info · STO-02 · ERC20Votes shares `lattice.storage.ERC20` with ERC20."],
    ]);
    expect(out[1]?.anchor).toEqual({ kind: "facet", facet: "ERC20" });
    expect(problemLines([])).toEqual([{ tag: "Note", text: NO_PROBLEMS }]);
  });
});

describe("summary (spec L376-L389)", () => {
  const base: SummaryInput = {
    facets: 4, blockers: 0, warnings: 0, online: true, recipeHash: "0xabc", deploy: { phase: "idle" },
    latestDeployLine: null, chainName: (id) => (id === 11155111 ? "Sepolia" : `Chain ${id}`),
  };
  const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as const;

  test("one state per row of the table", () => {
    expect(consoleSummary({ ...base, facets: 0 })).toEqual({ kind: "empty", text: EMPTY_SUMMARY, accent: false });
    expect(consoleSummary(base)).toEqual({ kind: "clear", text: "No problems", accent: false });
    expect(consoleSummary({ ...base, blockers: 2 })).toEqual({ kind: "problems", text: "2 blockers", accent: true });
    expect(consoleSummary({ ...base, blockers: 2, warnings: 1 }).text).toBe("2 blockers · 1 warning");
    expect(consoleSummary({ ...base, warnings: 1 })).toEqual({ kind: "problems", text: "1 warning", accent: false });
    expect(consoleSummary({ ...base, deploy: { phase: "pending" }, latestDeployLine: "Submitted 0x1234…abcd on Sepolia." }))
      .toEqual({ kind: "deploying", text: "Submitted 0x1234…abcd on Sepolia.", accent: false });
    expect(consoleSummary({ ...base, deploy: { phase: "proposed", safe, chainId: 11155111, snapshot: "0xabc" } }).text)
      .toBe("Proposed to Safe 0x71C7…976F on Sepolia");
    expect(consoleSummary({ ...base, deploy: { phase: "live", snapshot: "0xABC" } })).toEqual({ kind: "live", text: LIVE_SUMMARY, accent: true });
    expect(consoleSummary({ ...base, deploy: { phase: "mismatch" } })).toEqual({ kind: "mismatch", text: MISMATCH_SUMMARY, accent: true });
    expect(consoleSummary({ ...base, online: false, blockers: 3 })).toEqual({ kind: "offline", text: OFFLINE_SUMMARY, accent: false });
  });

  test("an outcome for another recipe no longer describes the sheet", () => {
    expect(consoleSummary({ ...base, blockers: 1, deploy: { phase: "live", snapshot: "0xdef" } }).kind).toBe("problems");
  });
});

describe("script chains", () => {
  test("the catalog's chains and Studio's, sorted; Anvil only in e2e builds", () => {
    expect(scriptChainIds({ chains: [] }, false)).toEqual([84532, 11155111]);
    expect(scriptChainIds({ chains: [{ chainId: 10 }] }, true)).toEqual([10, 31337, 84532, 11155111]);
  });
});
