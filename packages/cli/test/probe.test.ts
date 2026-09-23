/**
 * `--chain` readiness probes: a fake EIP-1193 provider in-process (which contracts are missing, which RPC
 * methods fail), and one real local Anvil node spawned on this worktree's port. Never a public network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSalt, CREATEX, factoryPredict, type Problem, toChecksum } from "@lattice-studio/core";
import { custom, keccak256 } from "viem";
import { sharedToProbe } from "../src/probe";
import { ANVIL_0, BUILT, coreRead, ENTROPY, REPO_ROOT, runCli, SAFE, spawnCli, tempDir, template, writeRecipe } from "./support";

const dir = tempDir();
const erc20 = writeRecipe(dir, template(BUILT, "ERC20"), BUILT, "erc20.json");

type Handler = (method: string, params: unknown[]) => unknown;

/** A provider for chain `chainId` whose `eth_getCode` answers from `code` (default: no code anywhere). */
function provider(chainId: number, code: Record<string, string> = {}, extra: Handler = () => undefined) {
  const calls: string[] = [];
  const transport = custom({
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push(method);
      const args = (params ?? []) as unknown[];
      const answer = extra(method, args);
      if (answer !== undefined) return answer;
      switch (method) {
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "eth_getCode":
          return code[String(args[0]).toLowerCase()] ?? "0x";
        case "eth_getBlockByNumber":
          return { number: "0x10", hash: `0x${"11".repeat(32)}`, parentHash: `0x${"22".repeat(32)}`, timestamp: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] };
        case "eth_simulateV1":
          throw new Error("the method eth_simulateV1 does not exist");
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  });
  return { transport: () => transport, calls };
}

const problemsOf = (stdout: string): Problem[] => (JSON.parse(stdout) as { problems: Problem[] }).problems;

describe("readiness probes", () => {
  test("nothing on the chain: NET-02, NET-03 and NET-07 from the probes; exit 1", async () => {
    const fake = provider(11155111);
    const { code, stdout } = await runCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY, "--rpc", "http://rpc.invalid", "--json"], { transport: fake.transport });
    expect(code).toBe(1);
    const problems = problemsOf(stdout);
    expect(problems.map((p) => p.code).filter((c) => c.startsWith("NET"))).toEqual(["NET-02", "NET-03", "NET-07"]);
    const net03 = problems.find((p) => p.code === "NET-03");
    expect(net03?.params["core"]).toEqual(["LatticeRegistry", "LatticeFactory"]);
    expect(net03?.params["missing"]).toContain("ERC20");
    expect(fake.calls).toContain("eth_simulateV1");
    expect(fake.calls.filter((m) => m === "eth_sendTransaction" || m === "eth_sendRawTransaction")).toEqual([]);
  });

  test("the predicted address already has code: NET-05; a shared contract with other code: NET-04", async () => {
    const salt = buildSalt(ANVIL_0, "every-chain", ENTROPY);
    const predicted = factoryPredict({ factory: toChecksum(BUILT.factory.address), proxyInitCodeHash: BUILT.proxy.initCodeHash, from: ANVIL_0, salt });
    const erc20Release = BUILT.facets.find((f) => f.name === "ERC20")?.release.address ?? "";
    const fake = provider(11155111, { [predicted.toLowerCase()]: "0x6001", [erc20Release.toLowerCase()]: "0x6002" }, (method) => (method === "eth_simulateV1" ? [] : undefined));
    const { stdout } = await runCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY, "--rpc", "http://rpc.invalid", "--json"], { transport: fake.transport });
    const problems = problemsOf(stdout);
    expect(problems.find((p) => p.code === "NET-05")?.params["address"]).toBe(predicted);
    expect(problems.find((p) => p.code === "NET-04")?.params).toMatchObject({ name: "ERC20", actual: keccak256("0x6002") });
    expect(problems.some((p) => p.code === "NET-07")).toBe(false);
  });

  test("the CreateX path probes CreateX (NET-01) and not the factory", async () => {
    const fake = provider(11155111);
    const { stdout } = await runCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY, "--path", "createx", "--rpc", "http://rpc.invalid", "--json"], { transport: fake.transport });
    const problems = problemsOf(stdout);
    expect(problems.find((p) => p.code === "NET-01")?.params["case"]).toBe("missing");
    expect(problems.find((p) => p.code === "NET-03")?.params["core"]).toEqual([]);
    expect(CREATEX).toBe("0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed");
  });

  test("an RPC for another chain: exit 2", async () => {
    const fake = provider(1);
    const { code, stderr } = await runCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY, "--rpc", "http://rpc.invalid"], { transport: fake.transport });
    expect(code).toBe(2);
    expect(stderr).toContain("The RPC serves chain 1, not 11155111. Pass an RPC for Sepolia.");
  });

  test("an unreachable RPC: checked without readiness, said on stderr, the URL never printed", async () => {
    const down = custom({
      request: async () => {
        throw new Error("fetch failed\nURL: http://secret-key.invalid/v3/abc123");
      },
    });
    const { code, stdout, stderr } = await runCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY, "--rpc", "http://secret-key.invalid/v3/abc123", "--json"], { transport: () => down });
    expect(code).toBe(0);
    expect(stderr).toMatch(/Couldn't reach Sepolia \(11155111\): .+ Checked without readiness./);
    expect(stderr + stdout).not.toContain("abc123");
    expect(problemsOf(stdout).some((p) => p.code.startsWith("NET"))).toBe(false);
  });

  test("--chain needs --deployer, and --deployer needs --chain", async () => {
    const a = await runCli(["check", erc20, "--chain", "11155111"]);
    expect(a.code).toBe(2);
    expect(a.stderr).toContain("--chain needs --deployer <address>");
    const b = await runCli(["check", erc20, "--deployer", ANVIL_0]);
    expect(b.code).toBe(2);
    expect(b.stderr).toContain("--deployer needs --chain <id>");
  });

  test("a chain Studio can't name and no --rpc: exit 2 asking for one", async () => {
    const { code, stderr } = await runCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "987654321", "--entropy", ENTROPY]);
    expect(code).toBe(2);
    expect(stderr).toContain("Chain 987654321 has no public RPC Studio knows. Pass --rpc <url> or set LATTICE_STUDIO_RPC_URL.");
  });

  test("the probe list: registry, factory, every placed facet and the init contracts", () => {
    const { recipe } = coreRead(erc20, BUILT);
    const names = [...sharedToProbe(recipe, BUILT, 11155111).keys()];
    expect(names).toEqual(expect.arrayContaining(["LatticeRegistry", "LatticeFactory", ...recipe.facets, "MultiInit", "ERC20Init"]));
  });

  test("the literal Safe address in the init is probed for code (AUTH-01, INIT-01 chain rules)", async () => {
    const recipe = template(BUILT, "SafeDiamondCut");
    if (recipe.init.kind !== "steps" || recipe.init.steps[0] === undefined) throw new Error("SafeDiamondCut changed shape");
    recipe.init.steps[0].args["safe"] = SAFE;
    const file = writeRecipe(dir, recipe, BUILT, "safe-cut.json");
    const fake = provider(11155111);
    const { stdout } = await runCli(["check", file, "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY, "--rpc", "http://rpc.invalid", "--json", "--confirm", `steps[0].safe=${SAFE}`], { transport: fake.transport });
    const init01 = problemsOf(stdout).find((p) => p.code === "INIT-01");
    expect(JSON.stringify(init01?.params)).toContain("No Safe at this address on Sepolia yet. Deploy the Safe first.");
  });
});

// One real local Anvil node, on this worktree's ANVIL_PORT_BASE (bun test sets NODE_ENV=test, which skips
// .env.local, so it's read here), or on a port the OS picks when that's unset or taken.
function envPort(): string | undefined {
  const fromEnv = process.env["ANVIL_PORT_BASE"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const file = join(REPO_ROOT, ".env.local");
  if (!existsSync(file)) return undefined;
  return /^ANVIL_PORT_BASE=(\d+)$/m.exec(readFileSync(file, "utf8"))?.[1];
}

const ANVIL = Bun.which("anvil");
let anvil: ReturnType<typeof Bun.spawn> | undefined;
let rpc = "";

/** Starts Anvil on `port` and resolves with its URL once it prints "Listening on", or null. */
async function startAnvil(binary: string, port: string): Promise<string | null> {
  const child = Bun.spawn([binary, "--port", port, "--chain-id", "31337"], { stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => null)]);
    if (chunk === null || chunk.done) break;
    seen += decoder.decode(chunk.value);
    const listening = /Listening on ([\d.]+:\d+)/.exec(seen);
    if (listening) {
      reader.releaseLock();
      anvil = child;
      return `http://${listening[1]}`;
    }
  }
  child.kill();
  return null;
}

describe.skipIf(ANVIL === null)("against a local Anvil node", () => {
  beforeAll(async () => {
    if (ANVIL === null) return;
    const own = envPort();
    const url = (own !== undefined ? await startAnvil(ANVIL, own) : null) ?? (await startAnvil(ANVIL, "0"));
    if (url === null) throw new Error("anvil didn't start");
    rpc = url;
  });
  afterAll(() => {
    anvil?.kill();
  });

  test("spawned: the shared contracts aren't on a fresh node, so NET-03 blocks (exit 1)", async () => {
    const { code, stdout } = await spawnCli(["check", erc20, "--deployer", ANVIL_0, "--chain", "31337", "--entropy", ENTROPY, "--rpc", rpc, "--json"]);
    expect(code).toBe(1);
    const problems = problemsOf(stdout);
    const net03 = problems.find((p) => p.code === "NET-03");
    expect(net03?.params["chain"]).toBe("Anvil");
    expect(net03?.params["missing"]).toContain("ERC20");
    // Anvil ships Arachnid's proxy, so NET-02 stays quiet.
    expect(problems.some((p) => p.code === "NET-02")).toBe(false);
  }, 30_000);
});
