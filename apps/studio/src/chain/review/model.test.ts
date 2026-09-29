import { describe, expect, test } from "bun:test";
import type { Catalog, ChainState, Hex, PlanEntry, Problem } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { CHOOSE_A_CHAIN, CONNECT_A_WALLET } from "@/chain/infra/copy";
import { CHANGED_SINCE_REVIEW, DEPLOY_NEEDS_CONNECTION, SAFE_SIGNS_BY_BATCH, SIMULATING, TYPE_THE_NAME } from "./copy";
import {
  CONTROLLER_NOT_BUILT, ackProblems, cantSimulate, changedSinceReview, cutRows, fundsShort, gasByFacet, grouped, magnitude,
  pendingAcks, problemStatus, readinessLine, resimulating, sectionOf, signEnablement, signStepNote, simulationOwnsError,
  worse, type SignInput,
} from "./model";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

const HASH = `0x${"ab".repeat(32)}` as Hex;
const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

function problem(id: string, severity: Problem["severity"], ack?: true): Problem {
  const code = id.split(":")[0] as Problem["code"];
  return { id, code, severity, where: [{ kind: "diamond" }], params: {}, message: `${id} message`, fixes: [], ...(ack ? { ack } : {}) };
}

function chainState(patch: Partial<ChainState> = {}): ChainState {
  return {
    chainId: 11155111, name: "Sepolia", online: true, probedAt: "2026-01-01T00:00:00.000Z",
    deployer: { present: true }, shared: {}, simulate: true, codeAt: {}, ...patch,
  };
}

/** Everything ready to sign; each test breaks one thing. */
function ready(patch: Partial<SignInput> = {}): SignInput {
  return {
    online: true,
    catalogBlock: null,
    blockers: 0,
    nextKey: "F8",
    chainId: 11155111,
    chainName: "Sepolia",
    readiness: { status: "ready", state: chainState() },
    account: { address: ALICE, chainId: 11155111, kind: "eoa" },
    walletChainName: "Sepolia",
    deploy: { phase: "ready", snapshot: HASH, simulation: { ok: true, block: 1 } },
    recipeHash: HASH,
    pendingAcks: 0,
    noSimulationTicked: false,
    mainnet: false,
    typedName: "",
    projectName: "GovernedVault",
    ...patch,
  };
}

function reason(patch: Partial<SignInput>): string | null {
  const result = signEnablement(ready(patch));
  return result.ok ? null : result.reason;
}

describe("Sign & deploy enablement (spec L573, IR L238)", () => {
  test("enables when nothing blocks, the simulation passed on the current snapshot and every tick is set", () => {
    expect(signEnablement(ready())).toEqual({ ok: true });
  });

  test("each missing condition disables it with its own reason", () => {
    expect(reason({ online: false })).toBe(DEPLOY_NEEDS_CONNECTION);
    expect(reason({ catalogBlock: "Fixture catalog: build the real catalog first" })).toBe("Fixture catalog: build the real catalog first");
    expect(reason({ catalogLoading: true })).toBe("The catalog hasn't loaded yet");
    expect(reason({ blockers: 2 })).toBe("Resolve 2 blockers · F8");
    expect(reason({ blockers: 1 })).toBe("Resolve 1 blocker · F8");
    // problem.next's key as remapped, or none when it has none (spec L661).
    expect(reason({ blockers: 2, nextKey: "⌥N" })).toBe("Resolve 2 blockers · ⌥N");
    expect(reason({ blockers: 2, nextKey: null })).toBe("Resolve 2 blockers");
    expect(reason({ chainId: null })).toBe(CHOOSE_A_CHAIN);
    expect(reason({ readiness: { status: "checking" } })).toBe("Checking Sepolia…");
    expect(reason({ readiness: { status: "error", reason: "Sepolia's public RPC isn't answering." } })).toBe("Sepolia's public RPC isn't answering.");
    expect(reason({ account: null })).toBe(CONNECT_A_WALLET);
    expect(reason({ account: { address: ALICE, chainId: 84532 }, walletChainName: "Base Sepolia" })).toBe("Your wallet is on Base Sepolia.");
    expect(reason({ account: { address: ALICE, chainId: 11155111, kind: "safe" } })).toBe(SAFE_SIGNS_BY_BATCH);
    expect(reason({ fundsShort: "Needs about 0.012 ETH; this account has 0.004." })).toBe("Needs about 0.012 ETH; this account has 0.004.");
    expect(reason({ pendingAcks: 1 })).toBe("Tick the acknowledgement first");
    expect(reason({ pendingAcks: 2 })).toBe("Tick the 2 acknowledgements first");
  });

  test("the simulation must have passed on the snapshot the review opened with", () => {
    expect(reason({ deploy: { phase: "idle" } })).toBe(CONTROLLER_NOT_BUILT);
    expect(reason({ deploy: { phase: "simulating", snapshot: HASH } })).toBe(SIMULATING);
    expect(reason({ deploy: { phase: "review", snapshot: HASH } })).toBe(SIMULATING);
    expect(reason({ deploy: { phase: "simulating", snapshot: HASH, changedSinceReview: true } })).toBe(CHANGED_SINCE_REVIEW);
    expect(reason({ deploy: { phase: "ready", snapshot: `0x${"cd".repeat(32)}`, simulation: { ok: true } } })).toBe(CHANGED_SINCE_REVIEW);
    expect(reason({ deploy: { phase: "review", snapshot: HASH, simulation: { ok: false, revert: "VaultCore: InvalidAsset()" } } }))
      .toBe("The simulation reverted: VaultCore: InvalidAsset()");
    expect(reason({ deploy: { phase: "awaitingSignature", snapshot: HASH } })).toBe("Waiting for your wallet");
    expect(reason({ deploy: { phase: "pending", snapshot: HASH } })).toBe("This deploy is already on its way");
  });

  test("a stop at Sign that dropped the simulation gives its reason, not Simulating…", () => {
    const error = "0x5FbD…0aa3 already has code on Sepolia.";
    expect(reason({ deploy: { phase: "review", snapshot: HASH, error } })).toBe(error);
    // Still simulating, or the new simulation under way: the error doesn't stand in for it.
    expect(reason({ deploy: { phase: "simulating", snapshot: HASH, error } })).toBe(SIMULATING);
  });

  test("a rejection in the wallet goes back to Review with the simulation standing: Sign again enables (spec L574)", () => {
    const deploy: SignInput["deploy"] = { phase: "review", snapshot: HASH, simulation: { ok: true, block: 1 } };
    expect(signEnablement(ready({ deploy }))).toEqual({ ok: true });
  });

  test("Changed since review stays marked once the new simulation passes, and no longer holds Sign back (spec L562, L573)", () => {
    const deploy: SignInput["deploy"] = { phase: "ready", snapshot: HASH, changedSinceReview: true, simulation: { ok: true, block: 2 } };
    expect(signEnablement(ready({ deploy }))).toEqual({ ok: true });
  });

  test("an RPC that can't simulate asks for one extra tick instead", () => {
    const deploy: SignInput["deploy"] = { phase: "review", snapshot: HASH, simulation: { ok: false } };
    expect(reason({ deploy })).toBe("Tick the acknowledgement first");
    expect(reason({ deploy, pendingAcks: 1 })).toBe("Tick the 2 acknowledgements first");
    expect(signEnablement(ready({ deploy, noSimulationTicked: true }))).toEqual({ ok: true });
  });

  test("read-only disables it with the session's reason (spec L389)", () => {
    expect(reason({ readOnly: "Another tab is editing this project" })).toBe("Another tab is editing this project");
    expect(signEnablement(ready({ readOnly: null }))).toEqual({ ok: true });
  });

  test("without a simulation it signs from Review only, never from Failed", () => {
    const simulation = { ok: false, unavailable: true } as const;
    expect(signEnablement(ready({ deploy: { phase: "review", snapshot: HASH, simulation }, noSimulationTicked: true }))).toEqual({ ok: true });
    expect(reason({ deploy: { phase: "failed", snapshot: HASH, simulation }, noSimulationTicked: true })).toBe(SIMULATING);
  });

  test("a mainnet needs the project name typed exactly (paste allowed)", () => {
    expect(reason({ mainnet: true })).toBe(TYPE_THE_NAME);
    expect(reason({ mainnet: true, typedName: "governedvault" })).toBe(TYPE_THE_NAME);
    expect(signEnablement(ready({ mainnet: true, typedName: " GovernedVault " }))).toEqual({ ok: true });
  });
});

describe("sections and their marks", () => {
  test("problems go to the section that proves them; the rest to Checks", () => {
    expect(sectionOf("NET-03")).toBe("network");
    expect(sectionOf("NET-05")).toBe("address");
    expect(sectionOf("NET-04")).toBe("cut");
    expect(sectionOf("INIT-01")).toBe("init");
    expect(sectionOf("AUTH-01")).toBe("authority");
    expect(sectionOf("LINK-01")).toBe("authority");
    expect(sectionOf("NET-06")).toBe("cost");
    expect(sectionOf("INIT-05")).toBe("checks");
    expect(sectionOf("CORE-02")).toBe("checks");
    expect(sectionOf("NET-08")).toBe("checks");
    expect(sectionOf("SEL-01")).toBe("checks");
  });

  test("a blocker blocks, an unticked acknowledgement needs a tick, info never counts", () => {
    const ack = problem("INIT-05:diamond", "warning", true);
    expect(problemStatus([problem("SEL-02:ERC20", "info")], [])).toBe("ok");
    expect(problemStatus([ack], [])).toBe("tick");
    expect(problemStatus([ack], [ack.id])).toBe("ok");
    expect(problemStatus([ack, problem("SEL-01:0x12345678", "blocker")], [ack.id])).toBe("blocked");
    expect(ackProblems([ack, problem("CORE-04:diamond", "warning")])).toEqual([ack]);
    expect(pendingAcks([ack], [])).toEqual([ack]);
    expect(worse("ok", "waiting")).toBe("waiting");
    expect(worse("blocked", "tick")).toBe("blocked");
  });
});

describe("readiness and the cut", () => {
  const erc20 = catalog.facets.find((f) => f.name === "ERC20");
  if (!erc20) throw new Error("fixture has ERC20");
  const entry: PlanEntry = {
    facet: "ERC20", address: erc20.release.address, codehash: erc20.release.codehash, version: erc20.release.version,
    selectors: erc20.selectors.map((s) => s.hex),
  };

  test("the readiness line counts what the deploy needs on the chain (spec L563)", () => {
    const chain = chainState({
      shared: { LatticeFactory: { present: true, codehash: catalog.factory.codehash }, ERC20: { present: true }, ERC20Init: { present: false } },
    });
    expect(readinessLine({ chainName: "Sepolia", path: "factory", chain, catalog, needed: ["ERC20", "ERC20Init"] }))
      .toBe("Sepolia · LatticeFactory ✓ · 1 of 2 facets and init contracts ✗");
    expect(readinessLine({ chainName: "Sepolia", path: "createx", chain, catalog, needed: ["ERC20"] }))
      .toBe("Sepolia · CreateX ✗ · 1 of 1 facets and init contracts ✓");
  });

  test("each facet's codehash check and where its expected codehash comes from (spec L566)", () => {
    const listed = chainState({
      shared: { ERC20: { present: true, codehash: entry.codehash } },
      registry: { records: { [`ERC20@${entry.version}`]: { facet: entry.address, codehash: entry.codehash } } },
    });
    expect(cutRows([entry], catalog, listed, "factory")[0]).toMatchObject({ check: "matches", source: "registry" });
    expect(cutRows([entry], catalog, listed, "createx")[0]).toMatchObject({ source: "catalog" });
    const partial = { ...entry, selectors: entry.selectors.slice(1) };
    expect(cutRows([partial], catalog, listed, "factory")[0]).toMatchObject({ source: "catalog", exported: entry.selectors.length });
    const drifted = chainState({ shared: { ERC20: { present: true, codehash: `0x${"11".repeat(32)}` } } });
    expect(cutRows([entry], catalog, drifted, "factory")[0]?.check).toBe("differs");
    expect(cutRows([entry], catalog, chainState({ shared: { ERC20: { present: false } } }), "factory")[0]?.check).toBe("missing");
    expect(cutRows([entry], catalog, undefined, "factory")[0]?.check).toBe("unknown");
  });
});

describe("cost helpers", () => {
  test("gas is apportioned by selectors, most expensive first", () => {
    const plan = [
      { facet: "A", selectors: ["0x00000001"] },
      { facet: "B", selectors: ["0x00000002", "0x00000003", "0x00000004"] },
    ] as unknown as PlanEntry[];
    expect(gasByFacet(plan, 400n)).toEqual([
      { facet: "B", selectors: 3, gas: 300n },
      { facet: "A", selectors: 1, gas: 100n },
    ]);
    expect(gasByFacet(plan, 0n).map((r) => r.gas)).toEqual([0n, 0n]);
  });

  test("magnitudes, grouping and short hashes read as the spec writes them", () => {
    expect(magnitude(16_777_216n)).toBe("16.8M");
    expect(magnitude(17_200_000n)).toBe("17.2M");
    expect(magnitude(820_000n)).toBe("820K");
    expect(grouped(9_123_456)).toBe("9,123,456");
  });

  test("not enough funds, in Flow 14's words", () => {
    const eth = { symbol: "ETH", decimals: 18 };
    expect(fundsShort(4n * 10n ** 15n, { about: 12n * 10n ** 15n }, eth)).toBe("Needs about 0.012 ETH; this account has 0.004.");
    expect(fundsShort(10n ** 18n, { about: 12n * 10n ** 15n }, eth)).toBeNull();
    expect(fundsShort(undefined, { about: 1n }, eth)).toBeNull();
  });

  test("a simulation that failed without a revert means the RPC couldn't simulate", () => {
    expect(cantSimulate({ ok: false })).toBe(true);
    expect(cantSimulate({ ok: false, unavailable: true, revert: "eth_call failed" })).toBe(true);
    expect(signEnablement(ready({ deploy: { phase: "review", snapshot: HASH, simulation: { ok: false, unavailable: true, revert: "x" } }, noSimulationTicked: true })))
      .toEqual({ ok: true });
    expect(cantSimulate({ ok: false, revert: "Reverted" })).toBe(false);
    expect(cantSimulate({ ok: true })).toBe(false);
    expect(cantSimulate(undefined)).toBe(false);
  });
});

describe("the review's marks after a change or a sign (spec L562, L574, L601)", () => {
  const OTHER = `0x${"cd".repeat(32)}` as Hex;

  test("Changed since review is marked while it simulates again and stays once the new result is in", () => {
    const simulating = { phase: "simulating" as const, snapshot: HASH, changedSinceReview: true };
    expect(changedSinceReview(simulating, HASH)).toBe(true);
    expect(resimulating(simulating, HASH)).toBe(true);
    const settled = { phase: "ready" as const, snapshot: HASH, changedSinceReview: true };
    expect(changedSinceReview(settled, HASH)).toBe(true);
    expect(resimulating(settled, HASH)).toBe(false);
    // An edit the controller hasn't taken up yet: the snapshot is an older recipe.
    expect(resimulating({ phase: "ready", snapshot: OTHER }, HASH)).toBe(true);
    expect(changedSinceReview({ phase: "ready", snapshot: HASH }, HASH)).toBe(false);
    expect(changedSinceReview({ phase: "pending", snapshot: OTHER, changedSinceReview: true }, HASH)).toBe(false);
  });

  test("simulating again needs a change: a first simulation, a changed review with no snapshot, and a deploy under way aren't", () => {
    // The review's first simulation isn't "again": no change was marked and the snapshot is the recipe's.
    expect(resimulating({ phase: "simulating", snapshot: HASH }, HASH)).toBe(false);
    expect(resimulating({ phase: "simulating" }, HASH)).toBe(false);
    // Marked changed, settled in Review, and no snapshot to be older than the recipe: the mark stays, nothing simulates.
    expect(resimulating({ phase: "review", changedSinceReview: true }, HASH)).toBe(false);
    expect(changedSinceReview({ phase: "review", changedSinceReview: true }, HASH)).toBe(true);
    // A failed deploy is before the next sign: an edit the controller hasn't taken up is simulating again.
    expect(resimulating({ phase: "failed", snapshot: OTHER, changedSinceReview: true }, HASH)).toBe(true);
    // Once a transaction is on its way, nothing "simulates again", whatever the flag or the snapshot says.
    expect(resimulating({ phase: "pending", snapshot: OTHER, changedSinceReview: true }, HASH)).toBe(false);
    expect(resimulating({ phase: "awaitingSignature", snapshot: OTHER }, HASH)).toBe(false);
  });

  test("the sign step's reason shows while the simulation stands, unless the Simulation section says it", () => {
    const canceled = "You canceled in your wallet.";
    const named = (id: number) => (id === 11155111 ? "Sepolia" : `Chain ${id}`);
    const note = (deploy: Parameters<typeof signStepNote>[0]) => signStepNote(deploy, named);
    const unavailable = { ok: false, unavailable: true } as const;
    expect(note({ phase: "review", error: canceled, simulation: { ok: true, block: 1 } })).toBe(canceled);
    expect(note({ phase: "review", chainId: 11155111, error: canceled, simulation: unavailable })).toBe(canceled);
    // The controller's own sentence, told by its flag and the exact words it writes for the chain.
    const cant = "Sepolia's RPC can't simulate this deploy. Signing without a simulation needs one more tick.";
    expect(note({ phase: "review", chainId: 11155111, error: cant, simulation: unavailable })).toBeNull();
    expect(simulationOwnsError({ chainId: 11155111, error: cant, simulation: unavailable }, named)).toBe(true);
    expect(simulationOwnsError({ chainId: 11155111, error: cant, simulation: { ok: false } }, named)).toBe(false);
    expect(simulationOwnsError({ chainId: 11155111, error: canceled, simulation: unavailable }, named)).toBe(false);
    // An error with no simulation standing is the simulation's own (or the chain's): its section says it.
    expect(note({ phase: "review", error: "Sepolia's public RPC isn't answering." })).toBeNull();
    expect(note({ phase: "failed", error: canceled, simulation: { ok: true } })).toBeNull();
    expect(note({ phase: "ready", simulation: { ok: true } })).toBeNull();
  });
});
