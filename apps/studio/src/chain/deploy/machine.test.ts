/**
 * Flow 12's state machine against a mocked chain (`testing.ts`): every transition of spec L532-L557, the records it
 * writes, the console lines and announcements, the stale timer on a manual clock, resume from a record and the
 * missing-contracts sub-step. The real catalog (CG8) and a real ERC20 recipe, so the transactions are C5c's.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Address, Catalog, Deployment, FacetDetail, Hex, Project } from "@lattice-studio/core";
import { CREATEX, createxProxy, formatAddress, loadTemplate, multicallGas, recipeHash } from "@lattice-studio/core";
import { encodeErrorResult, parseAbi } from "viem";
import { filledTemplate, loadBuiltCatalog, makeProject } from "@lattice-studio/core/testing";
import { CANCELED_IN_WALLET, DEPLOY_BANNER_ID, MISMATCH, notSeenFor, OFFLINE_TRACKING } from "./copy";
import { releaseOf, templatePlan } from "./judge";
import { createDeployMachine, type DeployMachine } from "./machine";
import { ALICE, BOB, deployHarness, flush, loupeOf, SEPOLIA_ID, type DeployHarness } from "./testing";

const built = loadBuiltCatalog();
if (!built.ok) throw new Error(built.error);
const catalog: Catalog = built.value;

/** The catalog's creation code, as the app's loader serves it (`code/<Name>.creation.hex`). */
function creationCode(name: string): Hex {
  const root = new URL("../../../../../catalog/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")) as { default: string; catalogs: { id: string; path: string }[] };
  const entry = manifest.catalogs.find((c) => c.id === manifest.default);
  const path = name === "Lattice" ? catalog.proxy.creationCode.path : releaseOf(catalog, name)?.creationCode.path;
  if (!entry || !path) throw new Error(`no creation code for ${name}`);
  return readFileSync(new URL(path, new URL(entry.path, root)), "utf8").trim() as Hex;
}

function project(name = "ERC20", overrides: Partial<Project> = {}): Project {
  const recipe = filledTemplate(catalog, name);
  if (!recipe.ok) throw new Error(recipe.error);
  return makeProject({ id: "p1", name: "Token", recipe: recipe.value, deploy: { path: "factory", entropy: "0x0102030405060708090a0b", scope: "every-chain" }, ...overrides });
}

type Rig = { h: DeployHarness; m: DeployMachine };

function rig(options: { project?: Project; account?: { address: Address; chainId: number } | null } = {}): Rig {
  const h = deployHarness({
    catalog,
    project: options.project ?? project(),
    ...(options.account === undefined ? {} : { account: options.account }),
  });
  h.inputs.setAck(h.inputs.analysis().problems.filter((p) => p.ack === true).map((p) => p.id));
  const m = createDeployMachine(h.deps);
  return { h, m };
}

/** The record written for `hash`. */
function recordOf(h: DeployHarness, hash: Hex): Deployment {
  const found = h.records.all().find((d) => d.tx === hash);
  if (!found) throw new Error(`no record for ${hash}`);
  return found;
}

function predicted(h: DeployHarness): Address {
  const p = h.inputs.prediction();
  if (p.status !== "ready") throw new Error(p.reason);
  return p.address;
}

/** `FailedContractCreation(CreateX)`, as CreateX reverts when the creation fails (no reason, spec L75). */
const FAILED_CREATION = encodeErrorResult({
  abi: parseAbi(["error FailedContractCreation(address emitter)"]), errorName: "FailedContractCreation", args: [CREATEX],
});

/** A rig on the CreateX path, with the proxy's creation code loaded. */
function createxRig(): Rig {
  const base = project();
  const r = rig({ project: { ...base, deploy: { ...base.deploy, path: "createx" } } });
  r.h.code.set("Lattice", creationCode("Lattice"));
  return r;
}

/** Holds every `codeAt` read until the returned function is called. */
function holdCodeAt(h: DeployHarness): () => void {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = h.port.codeAt.bind(h.port);
  h.port.codeAt = async (chainId, address) => {
    const answer = read(chainId, address);
    await held;
    return answer;
  };
  return release;
}

/** The addresses `codeAt` was asked about, lower-cased. */
function codeReads(h: DeployHarness): string[] {
  return h.port.calls.filter((c) => c.method === "codeAt").map((c) => String(c.args[1]).toLowerCase());
}

/** Open, simulate, sign: the transaction is pending. Returns its hash. */
async function submit({ h, m }: Rig): Promise<Hex> {
  m.open();
  await flush();
  expect(m.state().phase).toBe("ready");
  await m.sign();
  await flush();
  expect(m.state().phase).toBe("pending");
  const hash = m.state().tx;
  if (!hash) throw new Error("no tx");
  expect(h.port.watching()).toContain(hash);
  return hash;
}

describe("review and simulation", () => {
  test("open snapshots the recipe, says Review, simulates by itself and is ready", async () => {
    const { h, m } = rig();
    m.open();
    expect(m.state().phase).toBe("simulating");
    expect(m.state().snapshot).toBe(h.inputs.analysis().recipeHash);
    await flush();
    const s = m.state();
    expect(s.phase).toBe("ready");
    expect(s.simulation?.ok).toBe(true);
    expect(s.simulation?.block).toBe(9_123_456);
    expect(s.simulation?.summary).toMatch(/^Simulated at block 9,123,456: diamond at 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} with 4 facets, \d+ selectors, 7 events\.$/);
    expect(h.said.texts()).toContain("Review: Sepolia · LatticeFactory · 4 facets.");
    expect(h.said.texts()).toContain("Simulated at block 9,123,456: succeeded, 7 events.");
    expect(h.port.calls.find((c) => c.method === "noteEstimate")?.args).toEqual([SEPOLIA_ID, 3_000_000n]);
  });

  test("without eth_simulateV1 it simulates with eth_call and says so, with no event count", async () => {
    const { h, m } = rig();
    h.port.patch(SEPOLIA_ID, { simulate: false });
    m.open();
    await flush();
    expect(m.state().phase).toBe("ready");
    expect(m.state().simulation?.summary).not.toContain("event");
    expect(h.said.texts()).toContain("Simulated at block 9,123,456 with eth_call: succeeded.");
  });

  test("a revert goes back to Review, decoded, as a Deploy reverted Error line (the console announces it)", async () => {
    const { h, m } = rig();
    const abi = parseAbi(["error LatticeRegistry__RecordNotFound(bytes32 nameHash, uint64 version)"]);
    const data = encodeErrorResult({ abi, errorName: "LatticeRegistry__RecordNotFound", args: ["0x" + "11".repeat(32) as Hex, 1n] });
    h.port.simulation = { kind: "reverted", block: 12, data, method: "simulate" };
    m.open();
    await flush();
    expect(m.state().phase).toBe("review");
    expect(m.state().simulation?.ok).toBe(false);
    expect(m.state().simulation?.revert).toMatch(/^Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound\(/);
    const line = h.said.lines.at(-1);
    expect(line?.tag).toBe("Error");
    expect(line?.text).toMatch(/^Deploy reverted/);
    expect(h.port.calls.filter((c) => c.method === "noteEstimate").at(-1)?.args).toEqual([SEPOLIA_ID, null]);
  });

  describe("CreateX's FailedContractCreation before anything is signed (spec L75)", () => {
    /** Opens a CreateX review whose simulation (or, with `estimate`, its eth_call and gas estimate) reverts so. */
    async function simulated(code: { proxy?: boolean; diamond?: boolean }, estimate = false) {
      const r = createxRig();
      const { h, m } = r;
      const p = h.inputs.prediction();
      if (p.status !== "ready") throw new Error(p.reason);
      const proxy = createxProxy({ from: p.from, salt: p.salt, chainId: SEPOLIA_ID });
      if (code.proxy) h.port.setCode(proxy, "0x6000");
      if (estimate) h.port.patch(SEPOLIA_ID, { simulate: false });
      // Only the explanation's reads see the diamond's code: the probe stays clean, as NET-05 would have stopped it.
      if (code.diamond) {
        const read = h.port.codeAt.bind(h.port);
        h.port.codeAt = async (chainId, address) => {
          const answer = await read(chainId, address);
          return address.toLowerCase() === p.address.toLowerCase() ? { ok: true, value: "0x6000" } : answer;
        };
      }
      h.port.simulation = { kind: "reverted", block: 50, data: FAILED_CREATION, method: estimate ? "call" : "simulate" };
      m.open();
      await flush();
      return { ...r, proxy, diamond: p.address };
    }

    const cases = [
      { name: "the proxy has code", code: { proxy: true }, says: "The salt's CREATE3 proxy", tail: "has none: this salt was used before. Use a new salt." },
      { name: "the diamond has code", code: { diamond: true }, says: "The diamond address", tail: "has code on Sepolia but the salt's CREATE3 proxy" },
      { name: "neither has code", code: {}, says: "Neither the salt's CREATE3 proxy", tail: "so the salt is free: the creation itself failed." },
    ];
    for (const { name, code, says, tail } of cases) {
      test(`the simulation reverts and ${name}: said from both addresses' code, without a replay sentence`, async () => {
        const { h, m, proxy, diamond } = await simulated(code);
        const revert = m.state().simulation?.revert ?? "";
        expect(m.state()).toMatchObject({ phase: "review", simulation: { ok: false, block: 50 } });
        expect(revert).toMatch(/^Deploy reverted in CreateX: `FailedContractCreation\(/);
        expect(revert).toContain(`\`. ${says}`);
        expect(revert).toContain(tail);
        expect(revert).toContain(formatAddress(proxy));
        expect(revert).toContain(formatAddress(diamond));
        expect(revert).not.toContain("check the salt's addresses for code");
        // The simulation is the eth_call: nothing replayed it.
        expect(revert).not.toContain("Replayed with `eth_call`");
        expect(codeReads(h)).toEqual(expect.arrayContaining([proxy.toLowerCase(), diamond.toLowerCase()]));
        expect(h.said.lines.at(-1)).toEqual({ tag: "Error", text: revert });
      });
    }

    test("the gas estimate reverts (no eth_simulateV1): explained the same way", async () => {
      const { m, proxy } = await simulated({ proxy: true }, true);
      const revert = m.state().simulation?.revert ?? "";
      expect(revert).toContain(`The salt's CREATE3 proxy ${formatAddress(proxy)} has code on Sepolia`);
      expect(revert).toContain("this salt was used before. Use a new salt.");
    });

    test("a code read that fails says it couldn't read them", async () => {
      const r = createxRig();
      const { h, m } = r;
      h.port.codeAt = async () => ({ ok: false, error: "Sepolia's public RPC isn't answering." });
      h.port.simulation = { kind: "reverted", block: 51, data: FAILED_CREATION, method: "simulate" };
      m.open();
      await flush();
      expect(m.state().simulation?.revert).toMatch(
        /^Deploy reverted in CreateX: `FailedContractCreation\(.*\)`\. Couldn't read code at the salt's addresses on Sepolia: Sepolia's public RPC isn't answering\.$/,
      );
      expect(m.state().phase).toBe("review");
    });
  });

  test("an RPC failure stays in Review with the spec's sentence", async () => {
    const { h, m } = rig();
    h.port.down = true;
    m.open();
    await flush();
    expect(m.state()).toMatchObject({ phase: "review", error: "Sepolia's public RPC isn't answering." });
  });

  test("with blockers it doesn't simulate", async () => {
    const recipe = project();
    const { h, m } = rig({ project: { ...recipe, recipe: { ...recipe.recipe, facets: [] } } });
    m.open();
    await flush();
    expect(h.inputs.analysis().problems.some((p) => p.severity === "blocker")).toBe(true);
    expect(m.state().phase).toBe("review");
    expect(h.port.methods()).not.toContain("simulate");
  });

  test("an edit while it's open reads Changed since review and simulates again, once for several callers", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    const before = h.port.methods().filter((x) => x === "simulate").length;
    const p = h.inputs.project();
    h.inputs.setProject({ ...p, deploy: { ...p.deploy, entropy: "0x0b0a090807060504030201" as Hex } });
    m.changed();
    m.changed();
    // "Changed since review. Simulating again." while it simulates; the mark stays once the new result is in (spec
    // L562), so a fast chain doesn't hide it, and the new simulation is what Sign needs.
    expect(m.state()).toMatchObject({ phase: "simulating", changedSinceReview: true });
    await flush();
    expect(m.state()).toMatchObject({ phase: "ready", changedSinceReview: true, simulation: { ok: true } });
    expect(h.port.methods().filter((x) => x === "simulate").length).toBe(before + 1);
  });

  test("an account switch also marks the review changed", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.setAccount({ address: BOB, chainId: SEPOLIA_ID });
    h.inputs.touch();
    expect(m.state()).toMatchObject({ phase: "simulating", changedSinceReview: true, from: BOB });
    await flush();
    expect(m.state()).toMatchObject({ phase: "ready", from: BOB, changedSinceReview: true });
  });

  test("a new salt during review marks it changed and simulates the new address; Sign clears the mark", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    const first = predicted(h);
    const p = h.inputs.project();
    // Use a new salt writes the document; the machine sees it through its inputs, with no changed() call.
    h.inputs.setProject({ ...p, deploy: { ...p.deploy, entropy: "0x0b0a090807060504030201" as Hex } });
    expect(m.state()).toMatchObject({ phase: "simulating", changedSinceReview: true });
    await flush();
    expect(predicted(h)).not.toBe(first);
    expect(m.state()).toMatchObject({ phase: "ready", changedSinceReview: true, address: predicted(h) });
    await m.sign();
    await flush();
    expect(m.state().phase).toBe("pending");
    expect(m.state().changedSinceReview).toBeUndefined();
  });

  test("a failed simulation keeps Changed since review marked", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.down = true;
    h.port.setAccount({ address: BOB, chainId: SEPOLIA_ID });
    h.inputs.touch();
    await flush();
    expect(m.state()).toMatchObject({ phase: "review", error: "Sepolia's public RPC isn't answering.", changedSinceReview: true });
  });

  test("an edit that brings a blocker keeps the mark and doesn't simulate", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    const simulations = h.port.methods().filter((x) => x === "simulate").length;
    const p = h.inputs.project();
    h.inputs.setProject({ ...p, recipe: { ...p.recipe, facets: [] } });
    await flush();
    expect(h.inputs.analysis().problems.some((q) => q.severity === "blocker")).toBe(true);
    expect(m.state()).toMatchObject({ phase: "review", changedSinceReview: true });
    expect(h.port.methods().filter((x) => x === "simulate").length).toBe(simulations);
  });

  test("a fresh review starts unmarked", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.setAccount({ address: BOB, chainId: SEPOLIA_ID });
    h.inputs.touch();
    await flush();
    expect(m.state().changedSinceReview).toBe(true);
    m.close();
    m.open();
    await flush();
    expect(m.state().phase).toBe("ready");
    expect(m.state().changedSinceReview).toBeUndefined();
  });

  test("an RPC that can't simulate at all says so; signing then needs withoutSimulation, and goes out", async () => {
    const { h, m } = rig();
    h.port.simulation = { kind: "unavailable", message: "eth_call is not allowed." };
    m.open();
    await flush();
    expect(m.state()).toMatchObject({ phase: "review", error: "Sepolia's RPC can't simulate this deploy. Signing without a simulation needs one more tick.", simulation: { ok: false, unavailable: true } });
    await m.sign();
    expect(h.port.methods()).not.toContain("send");
    await m.sign({ withoutSimulation: true });
    await flush();
    expect(m.state().phase).toBe("pending");
    expect(h.port.sent).toHaveLength(1);
  });

  test("withoutSimulation is refused when the simulation simply failed", async () => {
    const { h, m } = rig();
    h.port.down = true;
    m.open();
    await flush();
    await m.sign({ withoutSimulation: true });
    expect(h.port.methods()).not.toContain("send");
    expect(h.said.texts().at(-1)).toBe("Signing without a simulation is only for an RPC that can't simulate.");
  });

  test("close before signing goes back to idle and stops caring about the simulation", async () => {
    const { m } = rig();
    m.open();
    m.close();
    await flush();
    expect(m.state().phase).toBe("idle");
  });
});

describe("signing", () => {
  test("rejected in the wallet: back to Review with the spec's words, and Sign again works", async () => {
    const r = rig();
    const { h, m } = r;
    m.open();
    await flush();
    h.port.sendQueue.push({ kind: "rejected" });
    await m.sign();
    await flush();
    // The simulation from before the send stands: nothing changed, so nothing simulates again (spec L574).
    expect(m.state()).toMatchObject({ phase: "review", error: CANCELED_IN_WALLET, simulation: { ok: true } });
    expect(m.state().changedSinceReview).toBeUndefined();
    expect(h.said.banners.has(DEPLOY_BANNER_ID)).toBe(false);
    // An Error line, so the default "errors" announcements read it; politely, since the person chose it.
    expect(h.said.lines.filter((l) => l.text === CANCELED_IN_WALLET)).toEqual([{ tag: "Error", text: CANCELED_IN_WALLET }]);
    expect(h.said.announced).toContainEqual([CANCELED_IN_WALLET, { politeness: "polite" }]);
    expect(h.port.methods().filter((x) => x === "simulate")).toHaveLength(1);
    await m.sign();
    await flush();
    expect(m.state().phase).toBe("pending");
    expect(h.port.methods().filter((x) => x === "simulate")).toHaveLength(1);
  });

  test("any other stop before the send says why in the console, not silently", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.setCode(predicted(h), "0x6000");
    await m.sign();
    const error = m.state().error ?? "";
    expect(error).toMatch(/already has code on Sepolia\. Use a new salt\.$/);
    expect(h.said.lines.at(-1)).toEqual({ tag: "Error", text: error });
  });

  test("after a refusal, a wallet gone or on another chain stops Sign again with an Error line, announced", async () => {
    for (const next of [null, { address: ALICE, chainId: 84532 }]) {
      const { h, m } = rig();
      m.open();
      await flush();
      h.port.sendQueue.push({ kind: "rejected" });
      await m.sign();
      await flush();
      h.port.setAccount(next);
      await m.sign();
      await flush();
      const error = m.state().error ?? "";
      expect(error).not.toBe(CANCELED_IN_WALLET);
      expect(error).toMatch(next === null ? /wallet/i : /^Your wallet is on Base Sepolia\.$/);
      expect(h.said.lines.at(-1)).toEqual({ tag: "Error", text: error });
      expect(h.said.announced).toContainEqual([error, { politeness: "polite" }]);
      expect(h.port.sent).toHaveLength(0);
    }
  });

  test("an edit during the wallet round-trip marks Changed since review on the way back and simulates it", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    let answer: () => void = () => {};
    h.port.hold = new Promise<void>((resolve) => {
      answer = resolve;
    });
    h.port.sendQueue.push({ kind: "rejected" });
    const signing = m.sign();
    await flush();
    expect(m.state().phase).toBe("awaitingSignature");
    const p = h.inputs.project();
    h.inputs.setProject({ ...p, deploy: { ...p.deploy, entropy: "0x0b0a090807060504030201" as Hex } });
    // Nothing simulates while the wallet asks: a new simulation would cut the send short.
    expect(h.port.methods().filter((x) => x === "simulate")).toHaveLength(1);
    answer();
    await signing;
    await flush();
    expect(m.state()).toMatchObject({ phase: "ready", changedSinceReview: true, address: predicted(h) });
    expect(h.port.methods().filter((x) => x === "simulate")).toHaveLength(2);
    expect(h.said.lines).toContainEqual({ tag: "Error", text: CANCELED_IN_WALLET });
  });

  test("with announcements off, a refusal is logged but not read", async () => {
    const { h, m } = rig();
    h.settings.deployAnnouncements = "none";
    m.open();
    await flush();
    h.port.sendQueue.push({ kind: "rejected" });
    await m.sign();
    expect(h.said.lines.at(-1)).toEqual({ tag: "Error", text: CANCELED_IN_WALLET });
    expect(h.said.announced.map(([text]) => text)).not.toContain(CANCELED_IN_WALLET);
  });

  test("submitted: record written pending, Submitted line, banner, and the tx asserted from the sender's salt", async () => {
    const r = rig();
    const { h } = r;
    const hash = await submit(r);
    const address = predicted(h);
    const record = h.records.get(SEPOLIA_ID, address);
    expect(record).toMatchObject({ projectId: "p1", status: "pending", tx: hash, deployer: ALICE, path: "factory", revision: 1, verification: "pending" });
    expect(record?.recipeHash).toBe(h.inputs.analysis().recipeHash);
    expect(record?.catalogHash).toBe(catalog.hash);
    expect(h.said.texts()).toContain(`Submitted ${hash.slice(0, 6)}…${hash.slice(-4)} on Sepolia.`);
    expect(h.said.banners.get(DEPLOY_BANNER_ID)?.text).toBe("Deploying the recipe as reviewed. Edits made now aren't part of it.");
    expect(h.said.banners.get(DEPLOY_BANNER_ID)?.actions).toEqual([{ id: "deploy.showProgress" }]);
    // Re-probed with refresh right before the send.
    const probes = h.port.calls.filter((c) => c.method === "probe");
    expect(probes.some((c) => (c.args[1] as { refresh?: boolean } | undefined)?.refresh === true)).toBe(true);
    expect(h.port.sent[0]?.tx.data.slice(0, 10)).toBe("0x533677de");
  });

  test("refuses to sign with unticked acknowledgements, and says why", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.inputs.setAck([]);
    await m.sign();
    expect(h.port.methods()).not.toContain("send");
    expect(h.said.texts().at(-1)).toBe("Tick 1 acknowledgement in the review first.");
  });

  test("the wallet on another chain: says where it is and doesn't send", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.setAccount({ address: ALICE, chainId: 84532 });
    await m.sign();
    expect(m.state().error).toBe("Your wallet is on Base Sepolia.");
    expect(h.port.methods()).not.toContain("send");
  });

  test("the predicted address already has code: back to Review, nothing sent", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.setCode(predicted(h), "0x6000");
    await m.sign();
    expect(m.state().phase).toBe("review");
    expect(m.state().error).toMatch(/already has code on Sepolia\. Use a new salt\.$/);
    expect(h.port.methods()).not.toContain("send");
  });
});

describe("the salt at Sign (spec L286, L574)", () => {
  test("a salt that disagrees with the sending account: nothing is sent, and the console says why", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    expect(m.state().phase).toBe("ready");
    // The prediction's salt no longer starts with the account it's for (a stored salt gone wrong).
    const prediction = h.inputs.prediction;
    h.inputs.prediction = () => {
      const p = prediction();
      return p.status === "ready" ? { ...p, salt: `${BOB.toLowerCase()}${p.salt.slice(42)}` as Hex } : p;
    };
    await m.sign();
    await flush();
    // Core's reason (C5b); FX48 appends its fix clause ("Use a new salt."), so match the sentence, not the whole line.
    const error = `The salt starts with ${BOB}, not the sending account ${ALICE}.`;
    expect(h.said.lines.some((line) => line.tag === "Error" && line.text.startsWith(error))).toBe(true);
    expect(h.port.methods()).not.toContain("send");
    expect(h.port.sent).toEqual([]);
    expect(h.said.banners.has(DEPLOY_BANNER_ID)).toBe(false);
    expect(m.state().phase).toBe("review");
    expect(m.state().error?.startsWith(error)).toBe(true);
  });
});

describe("tracking", () => {
  test("receipt, facets() matches the plan: Confirmed record, Deployed line, Verifying, then Live once verified", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    const address = predicted(h);
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 9_123_460 });
    await flush();
    expect(m.state().phase).toBe("verifying");
    expect(h.records.get(SEPOLIA_ID, address)).toMatchObject({ status: "confirmed", block: 9_123_460 });
    expect(h.said.texts()).toContain(`Deployed at ${address.slice(0, 6)}…${address.slice(-4)} in block 9,123,460. Matches the sheet.`);
    expect(h.said.banners.has(DEPLOY_BANNER_ID)).toBe(false);
    // Predicted-address code is cached: the chain is read again before facets().
    const lastProbe = h.port.calls.filter((c) => c.method === "probe").at(-1);
    expect((lastProbe?.args[1] as { refresh?: boolean } | undefined)?.refresh).toBe(true);
    const record = h.records.get(SEPOLIA_ID, address) as Deployment;
    h.records.write({ ...record, verification: "exact_match" });
    await flush();
    expect(m.state().phase).toBe("live");
  });

  test("facets() differs (a pre-used salt returned an older diamond): Mismatch, never Live", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    const address = predicted(h);
    const loupe = loupeOf(h.inputs.analysis().plan);
    const [first, ...rest] = loupe;
    if (!first) throw new Error("empty");
    h.port.setFacets(address, [{ ...first, functionSelectors: first.functionSelectors.slice(1) }, ...rest]);
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 50 });
    await flush();
    expect(m.state()).toMatchObject({ phase: "mismatch", error: MISMATCH });
    expect(h.records.get(SEPOLIA_ID, address)?.status).toBe("mismatch");
    expect(h.said.texts().at(-1)).toMatch(/^Deployed at 0x.{4}….{4}, but `facets\(\)` doesn't match the sheet: 1 selector differs\.$/);
  });

  test("stale after the receipt timeout (fake timers), Keep waiting, then a late receipt is still recorded", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.clock.advance(179_000);
    expect(m.state().phase).toBe("pending");
    h.clock.advance(1_000);
    expect(m.state()).toMatchObject({ phase: "stale", error: notSeenFor(180) });
    expect(notSeenFor(180)).toBe("Not seen for 3 minutes. It may have been dropped.");
    m.keepWaiting();
    expect(m.state().phase).toBe("pending");
    h.clock.advance(180_000);
    expect(m.state().phase).toBe("stale");
    const address = predicted(h);
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 77 });
    await flush();
    expect(m.state().phase).toBe("verifying");
    expect(h.records.get(SEPOLIA_ID, address)?.status).toBe("confirmed");
  });

  test("the timeout follows the setting", async () => {
    const r = rig();
    r.h.settings.receiptTimeout = 30;
    await submit(r);
    r.h.clock.advance(30_000);
    expect(r.m.state().error).toBe("Not seen for 30 seconds. It may have been dropped.");
  });

  test("Review again with the same salt: if the first transaction landed after all, it shows that diamond", async () => {
    const r = rig();
    const { h, m } = r;
    await submit(r);
    h.clock.advance(180_000);
    const address = predicted(h);
    h.port.setCode(address, "0x6000");
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    m.reviewAgain();
    await flush();
    expect(m.state().phase).toBe("verifying");
    expect(h.port.methods().filter((x) => x === "send").length).toBe(1);
    expect(h.said.texts().some((t) => t.startsWith("The first transaction landed after all"))).toBe(true);
  });

  test("Review again when nothing landed: back to Review with the same salt, simulated again", async () => {
    const r = rig();
    const { h, m } = r;
    await submit(r);
    const salt = h.records.all()[0]?.salt;
    h.clock.advance(180_000);
    m.reviewAgain();
    await flush();
    expect(m.state().phase).toBe("ready");
    expect(h.port.watching()).toEqual([]);
    const p = h.inputs.prediction();
    expect(p.status === "ready" ? p.salt : null).toBe(salt ?? null);
  });

  test("Check wallet says what the node knows and stays stale", async () => {
    const r = rig();
    await submit(r);
    r.h.clock.advance(180_000);
    r.h.port.txStatus = "unknown";
    r.m.checkWallet();
    await flush();
    expect(r.h.said.texts().at(-1)).toBe("Sepolia doesn't know this transaction. Open your wallet to see whether it was dropped or replaced.");
    expect(r.m.state().phase).toBe("stale");
  });

  test("sped up in the wallet: follows the new hash and rewrites the record", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    const next = `0x${"ab".repeat(32)}` as Hex;
    h.port.reprice(hash, next);
    await flush();
    expect(m.state().tx).toBe(next);
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.tx).toBe(next);
    expect(h.said.texts().at(-1)).toBe("Sped up in your wallet. Following 0xabab…abab.");
  });

  test("canceled in the wallet: Failed, and it says so", async () => {
    const r = rig();
    const hash = await submit(r);
    r.h.port.mine(hash, { kind: "replaced", reason: "cancelled", hash: `0x${"cd".repeat(32)}` });
    await flush();
    expect(r.m.state()).toMatchObject({ phase: "failed", error: "The transaction was canceled in your wallet." });
    expect(r.h.records.get(SEPOLIA_ID, predicted(r.h))?.status).toBe("failed");
  });

  test("a reverted receipt is replayed, decoded, recorded as failed; Retry goes back to Review", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.port.replayData = encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["nope"] });
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 40 });
    await flush();
    expect(m.state().phase).toBe("failed");
    expect(m.state().error).toMatch(/^Deploy reverted/);
    expect(h.records.get(SEPOLIA_ID, predicted(h))).toMatchObject({ status: "failed", block: 40 });
    expect(h.said.lines.at(-1)?.tag).toBe("Error");
    m.retry();
    await flush();
    expect(m.state().phase).toBe("ready");
  });

  test("a reverted receipt is decoded against the facets on the sheet when it was signed, not the sheet now", async () => {
    const r = rig();
    const { h, m } = r;
    h.details.set("Receive", {
      name: "Receive",
      abi: parseAbi(["error ReceiveStudioTestError(uint256 x)"]),
      natspec: { functions: {} },
      source: { path: "src/Receive.sol", url: "https://example.invalid/Receive.sol" },
    } as unknown as FacetDetail);
    const hash = await submit(r);
    const p = h.inputs.project();
    h.inputs.setProject({ ...p, recipe: { ...p.recipe, facets: p.recipe.facets.filter((f) => f !== "Receive") } });
    h.port.replayData = encodeErrorResult({ abi: parseAbi(["error ReceiveStudioTestError(uint256 x)"]), errorName: "ReceiveStudioTestError", args: [7n] });
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 41 });
    await flush();
    expect(m.state().error).toBe("Deploy reverted in Receive: `ReceiveStudioTestError(7)`.");
  });

  test("CreateX's FailedContractCreation: code read at the salt's CREATE3 proxy and the diamond address, then the replay", async () => {
    const cases = [
      { proxyCode: true, says: "has code on Sepolia but the diamond address", tail: "has none: this salt was used before. Use a new salt." },
      { proxyCode: false, says: "Neither the salt's CREATE3 proxy", tail: "has code on Sepolia, so the salt is free: the creation itself failed." },
    ];
    for (const { proxyCode, says, tail } of cases) {
      const r = createxRig();
      const { h, m } = r;
      const hash = await submit(r);
      const record = recordOf(h, hash);
      expect(record.path).toBe("createx");
      const proxy = createxProxy({ from: record.deployer, salt: record.salt, chainId: SEPOLIA_ID });
      if (proxyCode) h.port.setCode(proxy, "0x6000");
      h.port.replayData = FAILED_CREATION;
      h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 42 });
      await flush();
      const error = m.state().error ?? "";
      expect(m.state().phase).toBe("failed");
      expect(error).toMatch(/^Deploy reverted in CreateX: `FailedContractCreation\(/);
      expect(error).toContain(says);
      expect(error).toContain(formatAddress(proxy));
      expect(error).toContain(formatAddress(record.address));
      expect(error).toContain(tail);
      expect(error).toMatch(/Replayed with `eth_call` at the block before, the creation reverts the same way\.$/);
      expect(codeReads(h)).toEqual(expect.arrayContaining([proxy.toLowerCase(), record.address.toLowerCase()]));
      // The Error line with the decoder's hint first, then the explanation as its own line once the reads are in.
      const [reverted, explained] = h.said.lines.slice(-2);
      expect(reverted?.tag).toBe("Error");
      expect(reverted?.text).toMatch(/^Deploy reverted in CreateX: `FailedContractCreation\(.*CreateX gives no reason when creation fails/);
      expect(explained).toEqual({ tag: "Error", text: error.slice(error.indexOf(proxyCode ? "The salt's" : "Neither")) });
      expect(h.records.get(SEPOLIA_ID, record.address)).toMatchObject({ status: "failed", block: 42 });
    }
  });

  test("a failed deploy is recorded and said before the code reads return; the explanation attaches after", async () => {
    const r = createxRig();
    const { h, m } = r;
    const hash = await submit(r);
    const record = recordOf(h, hash);
    h.port.setCode(createxProxy({ from: record.deployer, salt: record.salt, chainId: SEPOLIA_ID }), "0x6000");
    const release = holdCodeAt(h);
    h.port.replayData = FAILED_CREATION;
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 44 });
    await flush();
    // Both reads are still out, and the record, the phase, the banner and the Error line are already there.
    expect(codeReads(h)).toHaveLength(2);
    expect(h.records.get(SEPOLIA_ID, record.address)).toMatchObject({ status: "failed", tx: hash, block: 44 });
    expect(m.state().phase).toBe("failed");
    expect(h.said.banners.has(DEPLOY_BANNER_ID)).toBe(false);
    const first = h.said.lines.at(-1);
    expect(first?.tag).toBe("Error");
    expect(first?.text).toMatch(/^Deploy reverted in CreateX: `FailedContractCreation\(.*CreateX gives no reason when creation fails/);
    expect(m.state().error).toBe(first?.text);
    const stored = h.records.get(SEPOLIA_ID, record.address);
    release();
    await flush();
    expect(m.state().error).toMatch(/^Deploy reverted in CreateX: `FailedContractCreation\(.*\)`\. The salt's CREATE3 proxy .* this salt was used before\. Use a new salt\./);
    expect(h.said.lines.at(-1)?.text).toMatch(/^The salt's CREATE3 proxy /);
    expect(h.records.get(SEPOLIA_ID, record.address)).toEqual(stored);
  });

  test("a code read that fails after a failed deploy says so and leaves the record as written", async () => {
    const r = createxRig();
    const { h, m } = r;
    const hash = await submit(r);
    const record = recordOf(h, hash);
    h.port.codeAt = async () => ({ ok: false, error: "Sepolia's public RPC isn't answering." });
    h.port.replayData = FAILED_CREATION;
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 45 });
    await flush();
    expect(h.said.lines.at(-1)).toEqual({
      tag: "Error",
      text: "Couldn't read code at the salt's addresses on Sepolia: Sepolia's public RPC isn't answering. Replayed with `eth_call` at the block before, the creation reverts the same way.",
    });
    expect(m.state().phase).toBe("failed");
    expect(m.state().error).toMatch(/^Deploy reverted in CreateX: `FailedContractCreation\(.*\)`\. Couldn't read code/);
    expect(h.records.get(SEPOLIA_ID, record.address)).toMatchObject({ status: "failed", tx: hash, block: 45 });
  });

  test("a code read that throws is said the same way, never left unhandled", async () => {
    const r = createxRig();
    const { h, m } = r;
    const hash = await submit(r);
    h.port.codeAt = async () => {
      throw new Error("socket closed");
    };
    h.port.replayData = FAILED_CREATION;
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 47 });
    await flush();
    expect(h.said.lines.at(-1)?.text).toMatch(/^Couldn't read code at the salt's addresses on Sepolia: socket closed\. /);
    expect(m.state().phase).toBe("failed");
  });

  test("an explanation that returns after Try again is logged, not written over the new review", async () => {
    const r = createxRig();
    const { h, m } = r;
    const hash = await submit(r);
    const release = holdCodeAt(h);
    h.port.replayData = FAILED_CREATION;
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 46 });
    await flush();
    m.retry();
    release();
    await flush();
    expect(m.state().phase).not.toBe("failed");
    expect(m.state().error ?? "").not.toContain("CREATE3 proxy");
    expect(h.said.texts().some((t) => t.startsWith("Neither the salt's CREATE3 proxy"))).toBe(true);
  });

  test("the explanation's line is read once: by the console while the failure shows, else by the machine", async () => {
    const r = createxRig();
    const { h } = r;
    const hash = await submit(r);
    h.port.replayData = FAILED_CREATION;
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 48 });
    await flush();
    // S5e's console reads Error lines while a failed deploy shows, so the machine doesn't announce it too.
    expect(h.said.announced.map(([text]) => text).some((t) => t.startsWith("Neither the salt's CREATE3 proxy"))).toBe(false);
  });

  test("on the factory path FailedContractCreation keeps the decoder's hint and reads no code", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.port.replayData = encodeErrorResult({ abi: parseAbi(["error FailedContractCreation(address emitter)"]), errorName: "FailedContractCreation", args: [CREATEX] });
    h.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 43 });
    await flush();
    expect(m.state().error).toContain("check the salt's addresses for code");
    expect(h.port.methods()).not.toContain("codeAt");
  });

  test("a tab demoted while the transaction is pending keeps tracking to confirmation, records it, and the other tab hears it (spec L505)", async () => {
    const r = rig();
    const { h, m } = r;
    const heard: string[] = [];
    // The tab that took over editing, listening to the same records.
    h.records.subscribe((projectId) => heard.push(projectId));
    const hash = await submit(r);
    const address = predicted(h);
    heard.length = 0;
    h.inputs.setReadOnly("Editing moved to another tab");
    expect(m.state().phase).toBe("pending");
    expect(h.port.watching()).toContain(hash);
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 77 });
    await flush();
    expect(m.state()).toMatchObject({ phase: "verifying", tx: hash });
    expect(h.records.get(SEPOLIA_ID, address)).toMatchObject({ status: "confirmed", block: 77, tx: hash });
    expect(heard).toContain("p1");
    expect((await h.records.list("p1")).find((d) => d.tx === hash)?.status).toBe("confirmed");
    expect(h.said.texts()).toContain(`Deployed at ${formatAddress(address)} in block 77. Matches the sheet.`);
  });

  test("offline mid-deploy says tracking resumes when you reconnect", async () => {
    const r = rig();
    await submit(r);
    r.h.inputs.setOnline(false);
    expect(r.m.state().error).toBe(OFFLINE_TRACKING);
    r.h.inputs.setOnline(true);
    await flush();
    expect(r.m.state().error).toBeUndefined();
  });

  test("a record the browser refuses to save is said aloud and tracking goes on", async () => {
    const r = rig();
    r.h.records.failWith = "Not saved: browser storage is full";
    const hash = await submit(r);
    expect(r.h.said.texts()).toContain("The deployment record wasn't saved: Not saved: browser storage is full. Tracking continues in this tab.");
    expect(r.h.said.announced.some(([, o]) => o?.politeness === "assertive")).toBe(true);
    expect(r.h.port.watching()).toContain(hash);
  });

  test("the dialog can close after submission: tracking continues", async () => {
    const r = rig();
    const hash = await submit(r);
    r.m.close();
    expect(r.m.state().phase).toBe("pending");
    expect(r.h.port.watching()).toContain(hash);
    r.m.open();
    expect(r.m.state().phase).toBe("pending");
    expect(r.h.said.texts().at(-1)).toBe("A deploy is already in flight. Show deploy progress to follow it.");
  });
});

describe("resume, proposals and From file records", () => {
  function record(h: DeployHarness, patch: Partial<Deployment>): Deployment {
    return {
      projectId: "p1",
      chainId: SEPOLIA_ID,
      address: predicted(h),
      path: "factory",
      deployer: ALICE,
      salt: `0x${ALICE.slice(2).toLowerCase()}000102030405060708090a0b` as Hex,
      status: "pending",
      recipeHash: h.inputs.analysis().recipeHash,
      catalogHash: catalog.hash,
      at: "2026-09-23T11:00:00.000Z",
      verification: "pending",
      revision: 1,
      ...patch,
    };
  }

  test("after a reload, a pending record resumes tracking from its transaction hash", async () => {
    const { h, m } = rig();
    const tx = `0x${"77".repeat(32)}` as Hex;
    h.records.seed([record(h, { tx })]);
    await m.refresh();
    await flush();
    expect(m.state()).toMatchObject({ phase: "pending", tx, since: "2026-09-23T11:00:00.000Z" });
    expect(h.port.watching()).toContain(tx);
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    h.port.mine(tx, { kind: "receipt", hash: tx, status: "success", block: 5 });
    await flush();
    expect(m.state().phase).toBe("verifying");
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.status).toBe("confirmed");
  });

  test("a From file record is re-read: facets() and codehashes match → confirmed, From file cleared", async () => {
    const { h, m } = rig();
    h.records.seed([record(h, { status: "confirmed", fromFile: true })]);
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    await m.refresh();
    await flush();
    const after = h.records.get(SEPOLIA_ID, predicted(h));
    expect(after?.status).toBe("confirmed");
    expect(after && "fromFile" in after).toBe(false);
    expect(m.state().phase).toBe("idle");
    expect(h.said.texts().at(-1)).toMatch(/^Re-read 0x.{4}….{4} on Sepolia: it matches its record\.$/);
  });

  test("a From file record whose code isn't the catalog's is saved as Mismatch", async () => {
    const { h, m } = rig();
    h.records.seed([record(h, { status: "confirmed", fromFile: true })]);
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    const first = h.inputs.analysis().plan[0];
    if (!first) throw new Error("empty");
    h.port.patch(SEPOLIA_ID, { shared: { ...catalog.facets.reduce((acc, f) => ({ ...acc, [f.name]: { present: true, codehash: f.release.codehash } }), {}), [first.facet]: { present: true, codehash: `0x${"00".repeat(32)}` } } });
    await m.refresh();
    await flush();
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.status).toBe("mismatch");
  });

  test("a From file record of a recipe Studio can't rebuild is never confirmed: it stays From file, unchecked", async () => {
    const { h, m } = rig();
    h.records.seed([record(h, { status: "confirmed", fromFile: true, recipeHash: `0x${"99".repeat(32)}` })]);
    // Any diamond made of genuine catalog releases: a file mustn't pass it off as this recipe's.
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    await m.refresh();
    await flush();
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.fromFile).toBe(true);
    expect(h.port.methods()).not.toContain("readFacets");
    expect(h.said.texts().at(-1)).toMatch(/^Couldn't check 0x.{4}….{4} on Sepolia: its record is for another recipe than this sheet\. It stays From file\.$/);
    // Focus again: said once.
    await m.refresh();
    await flush();
    expect(h.said.texts().filter((t) => t.startsWith("Couldn't check"))).toHaveLength(1);
  });

  test("a From file record of a Studio recipe (another than the sheet) is checked against that recipe's plan", async () => {
    const { h, m } = rig({ project: project("GovernedVault") });
    const erc20 = loadTemplate(catalog, "ERC20");
    if (!erc20.ok) throw new Error(erc20.error);
    const hash = recipeHash(erc20.value, catalog);
    const plan = templatePlan(catalog, hash);
    if (!plan) throw new Error("no template plan");
    h.records.seed([record(h, { status: "confirmed", fromFile: true, recipeHash: hash })]);
    h.port.setFacets(predicted(h), loupeOf(plan));
    await m.refresh();
    await flush();
    const after = h.records.get(SEPOLIA_ID, predicted(h));
    expect(after?.status).toBe("confirmed");
    expect(after?.fromFile).toBeUndefined();
  });

  test("re-reading several From file records probes each chain once", async () => {
    const { h, m } = rig();
    const plan = h.inputs.analysis().plan;
    const others = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"] as Address[];
    h.records.seed([record(h, { status: "confirmed", fromFile: true }), ...others.map((address) => record(h, { address, status: "confirmed", fromFile: true }))]);
    for (const address of [predicted(h), ...others]) h.port.setFacets(address, loupeOf(plan));
    await m.refresh();
    await flush();
    expect(h.port.methods().filter((x) => x === "probe")).toHaveLength(1);
    expect(h.port.methods().filter((x) => x === "readFacets")).toHaveLength(3);
    expect(h.records.all().every((d) => d.status === "confirmed" && d.fromFile === undefined)).toBe(true);
  });

  test("a write keeps a verification result another tab (S8d) already stored", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    const address = predicted(h);
    const stored = h.records.get(SEPOLIA_ID, address) as Deployment;
    h.records.seed([{ ...stored, verification: "exact_match" }]);
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 12 });
    await flush();
    expect(h.records.get(SEPOLIA_ID, address)).toMatchObject({ status: "confirmed", verification: "exact_match" });
    expect(m.state().phase).toBe("live");
  });

  test("a From file record at an address with no diamond stays From file and says it couldn't read it", async () => {
    const { h, m } = rig();
    h.records.seed([record(h, { status: "confirmed", fromFile: true })]);
    void m.refresh();
    await flush();
    h.clock.advance(5_000);
    await flush();
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.fromFile).toBe(true);
    expect(h.said.texts().at(-1)).toMatch(/^Couldn't read Sepolia for this record\./);
  });

  test("proposed: record Proposed, the console line, then confirmed once code appears on focus", async () => {
    const { h, m } = rig();
    const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as Address;
    const address = predicted(h);
    m.proposed({ safe, chainId: SEPOLIA_ID, address, salt: record(h, {}).salt });
    await flush();
    expect(m.state()).toMatchObject({ phase: "proposed", safe, address });
    expect(h.records.get(SEPOLIA_ID, address)?.status).toBe("proposed");
    expect(h.said.texts()).toContain("Proposed to Safe 0x71C7…976F on Sepolia. Waiting for the Safe to execute the batch.");
    h.port.setCode(address, "0x6000");
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    await m.refresh();
    await flush();
    expect(m.state().phase).toBe("verifying");
    expect(h.records.get(SEPOLIA_ID, address)?.status).toBe("confirmed");
  });

  test("a proposal resumes after a reload and Discard proposal drops it back to Review", async () => {
    const { h, m } = rig();
    const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as Address;
    h.records.seed([record(h, { status: "proposed", deployer: safe })]);
    await m.refresh();
    await flush();
    expect(m.state()).toMatchObject({ phase: "proposed", safe });
    m.discardProposal();
    await flush();
    expect(h.records.get(SEPOLIA_ID, predicted(h))).toBeUndefined();
    expect(["review", "ready"]).toContain(m.state().phase);
    expect(h.said.texts()).toContain("Discarded the proposal to Safe 0x71C7…976F on Sepolia.");
  });

  test("a failed record from a file is history: nothing re-reads it", async () => {
    const { h, m } = rig();
    h.records.seed([record(h, { status: "failed", fromFile: true })]);
    await m.refresh();
    await flush();
    expect(h.port.methods()).not.toContain("readFacets");
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.fromFile).toBe(true);
  });

  test("a proposal from a file waits quietly until code appears", async () => {
    const { h, m } = rig();
    h.records.seed([record(h, { status: "proposed", fromFile: true })]);
    await m.refresh();
    await flush();
    expect(h.said.texts()).toEqual([]);
    h.port.setCode(predicted(h), "0x6000");
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    await m.refresh();
    await flush();
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.status).toBe("confirmed");
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.fromFile).toBeUndefined();
  });

  test("a sign stopped by anything but a rejection needs a new simulation", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    h.port.setCode(predicted(h), "0x6000");
    await m.sign();
    expect(m.state().simulation).toBeUndefined();
    expect(h.port.methods()).not.toContain("send");
  });
});

describe("safety and resilience", () => {
  test("the wallet moving to another chain after the first check: nothing is sent, and it says where the wallet is", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    const probe = h.port.probe;
    h.port.probe = async (chainId, options) => {
      h.port.setAccount({ address: ALICE, chainId: 84532 });
      return probe(chainId, options);
    };
    await m.sign();
    expect(h.port.methods()).not.toContain("send");
    expect(m.state()).toMatchObject({ phase: "review", error: "Your wallet is on Base Sepolia." });
    // The simulation still stands: switch back and Sign again goes out.
    h.port.probe = probe;
    h.port.setAccount({ address: ALICE, chainId: SEPOLIA_ID });
    await m.sign();
    await flush();
    expect(m.state().phase).toBe("pending");
  });

  test("the pre-send probe reads the predicted address itself", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    await m.sign();
    const refreshed = h.port.calls.filter((c) => c.method === "probe" && (c.args[1] as { refresh?: boolean } | undefined)?.refresh === true);
    expect((refreshed[0]?.args[1] as { codeAt?: Address[] } | undefined)?.codeAt).toEqual([predicted(h)]);
  });

  test("a read-only tab doesn't sign or deploy missing contracts, and says why; tracking goes on", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.inputs.setReadOnly("Another tab is editing this project.");
    expect(h.port.watching()).toContain(hash);
    const address = predicted(h);
    h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 3 });
    await flush();
    expect(h.records.get(SEPOLIA_ID, address)?.status).toBe("confirmed");
    m.open();
    await flush();
    await m.sign();
    expect(h.said.texts().at(-1)).toBe("Another tab is editing this project.");
    expect(h.port.sent).toHaveLength(1);
    await m.deployMissing(["ERC20"]);
    expect(m.missingStep().error).toBe("Another tab is editing this project.");
  });

  test("Review again on a transaction the node dropped records it as failed, keeping its hash", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.clock.advance(180_000);
    h.port.txStatus = "unknown";
    m.reviewAgain();
    await flush();
    expect(h.records.get(SEPOLIA_ID, predicted(h))).toMatchObject({ status: "failed", tx: hash });
    expect(h.said.texts()).toContain(`Sepolia no longer knows ${hash.slice(0, 6)}…${hash.slice(-4)} and nothing landed: it was dropped. Recorded as failed.`);
    // No reload resumes it.
    const reloaded = createDeployMachine(h.deps);
    await reloaded.refresh();
    expect(reloaded.state().phase).toBe("idle");
    // If it lands after all, Sign shows that diamond instead of sending a second.
    expect(["review", "ready"]).toContain(m.state().phase);
    h.port.setCode(predicted(h), "0x6000");
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    await m.sign();
    await flush();
    expect(h.port.sent).toHaveLength(1);
    expect(m.state().phase).toBe("verifying");
    reloaded.dispose();
  });

  test("a cancel is recorded against the deploy's own hash", async () => {
    const r = rig();
    const hash = await submit(r);
    r.h.port.mine(hash, { kind: "replaced", reason: "cancelled", hash: `0x${"cd".repeat(32)}` });
    await flush();
    expect(r.h.records.get(SEPOLIA_ID, predicted(r.h))).toMatchObject({ status: "failed", tx: hash });
  });

  test("while verification runs, Deploy again opens a new review and close goes back to idle", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.port.setFacets(predicted(h), loupeOf(h.inputs.analysis().plan));
    h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 3 });
    await flush();
    expect(m.state().phase).toBe("verifying");
    m.close();
    expect(m.state().phase).toBe("idle");
    m.open();
    await flush();
    expect(m.state().phase).toBe("ready");
  });

  test("close during settle: the record is still written, and neither idle nor a new review is taken over", async () => {
    for (const next of ["close", "open"] as const) {
      const r = rig();
      const { h, m } = r;
      const hash = await submit(r);
      const address = predicted(h);
      // No loupe yet: settle is between its facets() tries (1 s, 3 s).
      h.port.mine(hash, { kind: "receipt", hash, status: "success", block: 8 });
      await flush();
      expect(m.state().phase).toBe("confirmed");
      m.close();
      if (next === "open") m.open();
      await flush();
      const before = m.state().phase;
      h.port.setFacets(address, loupeOf(h.inputs.analysis().plan));
      h.clock.advance(1_000);
      await flush();
      expect(h.records.get(SEPOLIA_ID, address)?.status).toBe("confirmed");
      expect(m.state().phase).toBe(before);
      expect(before).toBe(next === "close" ? "idle" : "ready");
    }
  });

  test("the chain module failing to load mid-tracking reads as Stale; Keep waiting picks it up again", async () => {
    const { h, m } = rig();
    const tx = `0x${"77".repeat(32)}` as Hex;
    h.records.seed([{
      projectId: "p1", chainId: SEPOLIA_ID, address: predicted(h), path: "factory", deployer: ALICE,
      salt: `0x${ALICE.slice(2).toLowerCase()}000102030405060708090a0b` as Hex, status: "pending", tx,
      recipeHash: h.inputs.analysis().recipeHash, catalogHash: catalog.hash, at: "2026-09-23T11:00:00.000Z",
      verification: "pending", revision: 1,
    }]);
    h.chainFails = "Failed to fetch dynamically imported module";
    await m.refresh();
    await flush();
    expect(m.state()).toMatchObject({ phase: "stale", tx, error: "Failed to fetch dynamically imported module." });
    h.chainFails = null;
    m.keepWaiting();
    await flush();
    expect(m.state().phase).toBe("pending");
    expect(h.port.watching()).toContain(tx);
  });

  test("Review again while the first transaction is still known: its record stays, and Sign won't send a second", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    h.clock.advance(180_000);
    h.port.txStatus = "pending";
    m.reviewAgain();
    await flush();
    const waiting = `${hash.slice(0, 6)}…${hash.slice(-4)} is still waiting on Sepolia with this salt. Keep waiting, speed it up in your wallet, or use a new salt.`;
    expect(h.said.texts()).toContain(waiting);
    expect(h.records.get(SEPOLIA_ID, predicted(h))).toMatchObject({ status: "pending", tx: hash });
    await m.sign();
    expect(h.port.sent).toHaveLength(1);
    expect(m.state()).toMatchObject({ phase: "review", error: waiting });
    expect(h.records.get(SEPOLIA_ID, predicted(h))?.tx).toBe(hash);
  });

  test("a proposal while a transaction is pending is refused and tracking goes on", async () => {
    const r = rig();
    const { h, m } = r;
    const hash = await submit(r);
    m.proposed({ safe: BOB, chainId: SEPOLIA_ID, address: predicted(h), salt: `0x${"00".repeat(32)}` });
    expect(m.state()).toMatchObject({ phase: "pending", tx: hash });
    expect(h.port.watching()).toContain(hash);
    expect(h.said.texts().at(-1)).toBe("A deploy is already in flight. Show deploy progress to follow it.");
  });

  test("another project opened during the wallet prompt: the record is saved, this review doesn't track it", async () => {
    const { h, m } = rig();
    m.open();
    await flush();
    let answer: () => void = () => {};
    h.port.hold = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const signing = m.sign();
    await flush();
    expect(m.state().phase).toBe("awaitingSignature");
    h.inputs.setProject(project("ERC20", { id: "p2" }));
    answer();
    await signing;
    await flush();
    expect(h.records.all().find((d) => d.projectId === "p1")?.status).toBe("pending");
    expect(m.state().phase).not.toBe("pending");
    expect(h.port.watching()).toEqual([]);
  });
});

describe("announcements (spec L778)", () => {
  test("deploy lines are the console's to announce (S5e), so the machine never reads them twice", async () => {
    for (const mode of ["errors", "all", "none"] as const) {
      const { h, m } = rig();
      h.settings.deployAnnouncements = mode;
      h.port.simulation = { kind: "reverted", block: 12, data: "0x", method: "simulate" };
      m.open();
      await flush();
      expect(h.said.lines.some((l) => l.tag === "Error" && l.text.startsWith("Deploy reverted"))).toBe(true);
      expect(h.said.announced).toEqual([]);
    }
  });

  test("a record the browser refused to save interrupts, unless announcements are off", async () => {
    for (const mode of ["errors", "none"] as const) {
      const r = rig();
      r.h.settings.deployAnnouncements = mode;
      r.h.records.failWith = "Not saved: browser storage is full";
      await submit(r);
      expect(r.h.said.announced.map(([, o]) => o?.politeness)).toEqual(mode === "none" ? [] : ["assertive"]);
    }
  });
});

describe("missing contracts", () => {
  function missingRig(): Rig & { names: string[] } {
    const r = rig();
    const names = [catalog.facets[0]?.name ?? "", catalog.facets[1]?.name ?? "", catalog.facets[2]?.name ?? ""];
    const shared = Object.fromEntries(names.map((name) => [name, { present: false }]));
    const base = r.h.port.probe;
    r.h.port.probe = async (chainId, options) => {
      const result = await base(chainId, options);
      if (!result.ok) return result;
      return { ok: true, value: { ...result.value, shared: { ...result.value.shared, ...shared } } };
    };
    for (const name of names) r.h.code.set(name, creationCode(name));
    r.h.port.onMined = (tx) => {
      // Arachnid's proxy put every contract of the transaction at its address.
      for (const name of names) {
        const facet = catalog.facets.find((f) => f.name === name);
        if (facet && tx?.data.includes(facet.release.salt.slice(2))) shared[name] = { present: true } as never;
        if (tx?.to.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") shared[name] = { present: true } as never;
      }
    };
    r.h.port.autoMine = true;
    return { ...r, names };
  }

  test("without a known gas cap for batching, one transaction each through Arachnid's proxy, each Deployed", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    await m.prepareMissing(SEPOLIA_ID, names);
    expect(m.missingStep().items.map((i) => i.status)).toEqual(["missing", "missing", "missing"]);
    expect(m.missingStep().items.every((i) => i.gas === 1_000_000n)).toBe(true);
    await m.deployMissing(names);
    expect(h.port.sent.length).toBe(3);
    expect(h.port.sent.every((s) => s.tx.to === "0x4e59b44847b379578588920cA78FbF26c0B4956C")).toBe(true);
    expect(m.missingStep().items.map((i) => i.status)).toEqual(["deployed", "deployed", "deployed"]);
    expect(m.missingStep().mode).toBe("transactions");
    expect(m.state().missing?.map((x) => x.status)).toEqual(["deployed", "deployed", "deployed"]);
    expect(h.said.texts().at(-1)).toBe("Deployed 3 missing contracts on Sepolia.");
    // The chain is read again before every send.
    expect(h.port.calls.filter((c) => c.method === "probe" && (c.args[1] as { refresh?: boolean })?.refresh).length).toBeGreaterThanOrEqual(4);
  });

  test("with Multicall3's canonical codehash they go as one aggregate3 batch under the cap", async () => {
    const { h, m, names } = missingRig();
    await m.deployMissing(names);
    expect(h.port.sent.length).toBe(1);
    expect(h.port.sent[0]?.tx.to).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
    // aggregate3 with failures allowed never reverts, so the batch carries its own gas, not the wallet's estimate.
    expect(h.port.sent[0]?.gas).toBe(multicallGas([1_000_000n, 1_000_000n, 1_000_000n]));
    expect(m.missingStep().mode).toBe("multicall");
    expect(m.missingStep().items.every((i) => i.status === "deployed")).toBe(true);
  });

  test("an EIP-5792 batch when the wallet reports atomic support and Multicall3 isn't usable", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: true, codehash: `0x${"00".repeat(32)}` } });
    h.port.atomic = true;
    await m.deployMissing(names);
    expect(h.port.batches.length).toBe(1);
    expect(h.port.batches[0]?.calls.length).toBe(3);
    expect(m.missingStep().mode).toBe("calls");
  });

  test("a contract that doesn't land is Failed with a diagnosis, and Retry deploys just it", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    const stubborn = names[1] ?? "";
    const mined = h.port.onMined;
    h.port.onMined = (tx, hash) => {
      const facet = catalog.facets.find((f) => f.name === stubborn);
      if (facet && tx?.data.includes(facet.release.salt.slice(2))) return;
      mined?.(tx, hash);
    };
    h.port.callResult = { ok: false, data: "0x", message: "reverted" };
    await m.deployMissing(names);
    const item = m.missingStep().items.find((i) => i.name === stubborn);
    expect(item?.status).toBe("failed");
    expect(item?.reason).toBe(`Creating ${stubborn} reverts: Arachnid's proxy gives no reason, so check the gas and the chain's code size limit.`);
    expect(h.said.texts().at(-1)).toBe("Deployed 2 of 3 missing contracts on Sepolia; 1 failed.");
    h.port.onMined = mined;
    await m.deployMissing([stubborn]);
    expect(m.missingStep().items.find((i) => i.name === stubborn)?.status).toBe("deployed");
  });

  test("no wallet: the step says to connect one and sends nothing", async () => {
    const { h, m, names } = missingRig();
    h.port.setAccount(null);
    await m.deployMissing(names);
    expect(m.missingStep().error).toBe("Connect a wallet first.");
    expect(h.port.sent).toEqual([]);
  });

  test("canceled in the wallet stops the step", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    h.port.sendQueue.push({ kind: "rejected" });
    await m.deployMissing(names);
    expect(m.missingStep()).toMatchObject({ running: false, error: CANCELED_IN_WALLET });
  });

  test("a send never seen within the receipt timeout fails its contracts and frees the step; a second run proceeds", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    h.port.autoMine = false;
    const running = m.deployMissing(names);
    await flush();
    expect(m.missingStep().running).toBe(true);
    expect(h.port.watching()).toHaveLength(1);
    h.clock.advance(180_000);
    await running;
    const step = m.missingStep();
    expect(step.running).toBe(false);
    expect(step.error).toBe("Not seen for 3 minutes. It may have been dropped.");
    expect(step.items.find((i) => i.name === names[0])).toMatchObject({ status: "failed", reason: "Not seen for 3 minutes. It may have been dropped." });
    expect(h.port.watching()).toEqual([]);
    expect(h.said.texts().at(-1)).toBe("Not seen for 3 minutes. It may have been dropped.");
    h.port.autoMine = true;
    await m.deployMissing(names);
    expect(m.missingStep().items.map((i) => i.status)).toEqual(["deployed", "deployed", "deployed"]);
  });

  test("a speed-up restarts the wait: the first deadline no longer aborts it", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    h.port.autoMine = false;
    const running = m.deployMissing(names);
    await flush();
    const [first] = h.port.watching();
    if (!first) throw new Error("nothing sent");
    h.clock.advance(100_000);
    const next = `0x${"ef".repeat(32)}` as Hex;
    h.port.reprice(first, next);
    h.clock.advance(100_000);
    await flush();
    expect(m.missingStep().running).toBe(true);
    expect(h.port.watching()).toEqual([next]);
    h.clock.advance(80_000);
    await running;
    expect(m.missingStep()).toMatchObject({ running: false, error: "Not seen for 3 minutes. It may have been dropped." });
  });

  test("a stuck EIP-5792 batch times out the same way", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    h.port.atomic = true;
    h.port.autoMine = false;
    const running = m.deployMissing(names);
    await flush();
    h.clock.advance(180_000);
    await running;
    expect(m.missingStep()).toMatchObject({ running: false, error: "Not seen for 3 minutes. It may have been dropped." });
  });

  test("dispose or another project stops the step: nothing reads as running", async () => {
    for (const how of ["dispose", "project"] as const) {
      const { h, m, names } = missingRig();
      h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
      h.port.autoMine = false;
      const running = m.deployMissing(names);
      await flush();
      if (how === "dispose") m.dispose();
      else h.inputs.setProject(project("ERC20", { id: "p2" }));
      await running;
      expect(m.missingStep().running).toBe(false);
      expect(h.port.watching()).toEqual([]);
    }
  });

  test("a canceled send says so rather than suggesting a retry", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    h.port.autoMine = false;
    const running = m.deployMissing(names);
    await flush();
    const [hash] = h.port.watching();
    if (!hash) throw new Error("nothing sent");
    h.port.mine(hash, { kind: "replaced", reason: "cancelled", hash: `0x${"cd".repeat(32)}` });
    await running;
    expect(m.missingStep().items.find((i) => i.name === names[0])).toMatchObject({ status: "failed", reason: "The transaction was canceled in your wallet." });
  });

  test("the wallet moving to another chain between sends stops before the next one", async () => {
    const { h, m, names } = missingRig();
    h.port.patch(SEPOLIA_ID, { multicall3: { present: false } });
    const mined = h.port.onMined;
    h.port.onMined = (tx, hash) => {
      mined?.(tx, hash);
      h.port.setAccount({ address: ALICE, chainId: 84532 });
    };
    await m.deployMissing(names);
    expect(h.port.sent).toHaveLength(1);
    expect(m.missingStep()).toMatchObject({ running: false, error: "Your wallet is on Base Sepolia." });
  });
});
