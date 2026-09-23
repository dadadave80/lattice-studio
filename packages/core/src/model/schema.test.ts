import { describe, expect, test } from "bun:test";
import * as z from "zod";
import type { Recipe } from "./recipe";
import {
  AbiItemSchema,
  formatPath,
  listUnknownFields,
  MAX_JSON_DEPTH,
  RecipeSchema,
  validate,
  validateCatalogManifest,
  validateDeployment,
  validateFacetDetail,
  validateProject,
  validateProjectFile,
  validateRecipe,
  validateSharePayload,
} from "./schema";

const HASH = `0x${"3f".repeat(32)}` as const;
const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

/** GovernedVault's shape (spec L407-L411; `DeployGovernedVault.s.sol` at the pin): 14 facets, owners, a bundle init. */
const governedVault: Recipe = {
  $schema: "https://lattice-studio.invalid/schema/recipe.v1.json",
  schemaVersion: 1,
  name: "GovernedVault",
  catalog: { tag: "v0.4.0", hash: HASH },
  template: { name: "GovernedVault", catalogHash: HASH },
  facets: [
    "DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "EmergencyStop", "GovernedDiamondCut", "ERC20",
    "ERC4626", "VaultCore", "Votes", "ERC20Votes", "TimelockController", "Governor", "GovernedVault",
  ],
  owners: { "0x06fdde03": "GovernedVault", "0x91ddadf4": "GovernedVault", "0x4bf5d7e9": "GovernedVault" },
  exclude: [],
  init: {
    kind: "bundle",
    spec: "GovernedVaultInit",
    args: {
      p: {
        asset: ADDRESS,
        name: "Grant vault",
        symbol: "gVLT",
        decimalsOffset: "0",
        minDelay: "300",
        votingDelay: "60",
        votingPeriod: "600",
        proposalThreshold: "0",
        quorumNumerator: "4",
      },
    },
  },
};

function issues(result: { ok: boolean; error?: unknown }): { path: string; message: string }[] {
  if (result.ok) throw new Error("expected a failure");
  return result.error as { path: string; message: string }[];
}

describe("recipe schema", () => {
  test("a GovernedVault-shaped recipe parses with nothing unknown", () => {
    const result = validateRecipe(governedVault);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual(governedVault);
      expect(result.value.unknownFields).toEqual([]);
    }
  });

  test("steps and none inits parse, references included", () => {
    const steps: Recipe = {
      ...governedVault,
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
          { spec: "ERC20Init", args: { name: "Token", symbol: "TKN", flags: [true, false] } },
        ],
      },
      immutable: true,
    };
    expect(validateRecipe(steps).ok).toBe(true);
    expect(validateRecipe({ ...governedVault, init: { kind: "none" } }).ok).toBe(true);
  });

  test("a number in facets fails at facets[0]", () => {
    expect(issues(validateRecipe({ ...governedVault, facets: [3] }))).toEqual([
      { path: "facets[0]", message: "is 3; expected text." },
    ]);
  });

  test("an unknown top-level field survives and is listed", () => {
    const result = validateRecipe({ ...governedVault, color: "orange" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value.value as Record<string, unknown>)["color"]).toBe("orange");
      expect(result.value.unknownFields).toEqual(["color"]);
    }
  });

  test("unknown fields are listed at every level, but free-form records have none", () => {
    const json = {
      ...governedVault,
      catalog: { ...governedVault.catalog, note: 1 },
      init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { anything: "goes" }, why: "x" }] },
      z: true,
    };
    const result = validateRecipe(json);
    expect(result.ok && result.value.unknownFields).toEqual(["catalog.note", "init.steps[0].why", "z"]);
  });

  test("schemaVersion 2 fails and names the version it needs", () => {
    expect(issues(validateRecipe({ ...governedVault, schemaVersion: 2 }))).toEqual([
      { path: "schemaVersion", message: "is 2: this file needs Studio schema v2. This Studio reads v1." },
    ]);
    expect(issues(validateRecipe({ ...governedVault, schemaVersion: "1" }))).toEqual([
      { path: "schemaVersion", message: 'is "1"; expected 1.' },
    ]);
  });

  test("missing fields are named one by one", () => {
    expect(issues(validateRecipe({})).map((issue) => issue.path)).toEqual([
      "schemaVersion", "catalog", "facets", "owners", "exclude", "init",
    ]);
    expect(issues(validateRecipe({})).every((issue) => issue.message === "is missing.")).toBe(true);
  });

  test("hex, selectors and owners keys are checked; case is left for normalization", () => {
    expect(validateRecipe({ ...governedVault, owners: { "0xA9059CBB": "ERC20" }, exclude: ["0xCDFE7F5C"] }).ok).toBe(true);
    expect(issues(validateRecipe({ ...governedVault, owners: { "0xzz": "ERC20" } }))).toEqual([
      { path: 'owners["0xzz"]', message: 'is "0xzz"; expected a 4-byte selector (0x followed by 8 hex digits).' },
    ]);
    expect(issues(validateRecipe({ ...governedVault, exclude: ["0xa9059cbb00"] }))[0]?.path).toBe("exclude[0]");
    expect(issues(validateRecipe({ ...governedVault, catalog: { tag: "v0.4.0", hash: "0xabc" } }))[0]).toEqual({
      path: "catalog.hash",
      message: 'is "0xabc"; expected a 32-byte hash (0x followed by 64 hex digits).',
    });
  });

  test("hashes are exactly 32 bytes: 0x alone and short hex fail", () => {
    for (const hash of ["0x", "0xabcd", `0x${"ab".repeat(33)}`]) {
      expect(issues(validateRecipe({ ...governedVault, catalog: { tag: "v0.4.0", hash } }))[0]?.path).toBe("catalog.hash");
    }
    expect(validateRecipe({ ...governedVault, catalog: { tag: "v0.4.0", hash: `0x${"AB".repeat(32)}` } }).ok).toBe(true);
  });

  test("keys named like Object.prototype members are listed as unknown", () => {
    const json: unknown = JSON.parse(
      JSON.stringify({ ...governedVault, constructor: 1, toString: "x" }).replace(/^\{/, '{"__proto__":{"a":1},'),
    );
    const result = validateRecipe(json);
    expect(result.ok && [...result.value.unknownFields].sort()).toEqual(["__proto__", "constructor", "toString"]);
  });

  test("JSON nested past the depth limit is refused quickly, with a path", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 3000; i++) deep = [deep];
    const hostile = { ...governedVault, init: { kind: "bundle", spec: "X", args: { a: deep } } };
    const started = performance.now();
    const [issue] = issues(validateRecipe(hostile));
    expect(performance.now() - started).toBeLessThan(250);
    expect(issue?.message).toBe(`nests deeper than ${MAX_JSON_DEPTH} levels.`);
    expect(issue?.path.startsWith("init.args.a[0][0]")).toBe(true);
    let fine: unknown = "x";
    for (let i = 0; i < 40; i++) fine = [fine];
    expect(validateRecipe({ ...governedVault, init: { kind: "bundle", spec: "X", args: { a: fine } } }).ok).toBe(true);
  });

  test("numbers aren't arguments: integers travel as decimal strings", () => {
    const bad = { ...governedVault, init: { kind: "bundle", spec: "GovernedVaultInit", args: { p: { quorumNumerator: 4 } } } };
    const [issue] = issues(validateRecipe(bad));
    expect(issue?.path).toBe("init.args.p.quorumNumerator");
    expect(issue?.message).toContain("integers as decimal strings");
    const two = { ...governedVault, init: { kind: "bundle", spec: "X", args: { p: { a: 1, b: [2] } } } };
    expect(issues(validateRecipe(two)).map((i) => i.path)).toEqual(["init.args.p.a", "init.args.p.b[0]"]);
  });

  test("a bad reference fails instead of passing as a plain object", () => {
    const bad = { ...governedVault, init: { kind: "bundle", spec: "X", args: { admin: { $ref: "me" } } } };
    expect(issues(validateRecipe(bad))).toEqual([
      { path: "init.args.admin.$ref", message: 'is "me"; expected "self" or "deployer".' },
    ]);
  });

  test("an unknown init kind names the kinds", () => {
    expect(issues(validateRecipe({ ...governedVault, init: { kind: "later" } }))).toEqual([
      { path: "init.kind", message: 'has kind "later"; expected "bundle", "steps" or "none".' },
    ]);
  });

  test("immutable is the literal true", () => {
    expect(issues(validateRecipe({ ...governedVault, immutable: false }))[0]?.path).toBe("immutable");
  });

  test("the recipe schema converts to JSON Schema (C7b publishes it)", () => {
    const schema = z.toJSONSchema(RecipeSchema, { io: "input" });
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["schemaVersion", "catalog", "facets", "owners", "exclude", "init"]);
  });

  test("the share payload is the recipe; a $schema in it is kept as unknown", () => {
    const { $schema: _, ...payload } = governedVault;
    const clean = validateSharePayload(payload);
    expect(clean.ok && clean.value.unknownFields).toEqual([]);
    const withSchema = validateSharePayload(governedVault);
    expect(withSchema.ok && withSchema.value.unknownFields).toEqual(["$schema"]);
  });
});

describe("project, deployments and files", () => {
  const project = {
    id: "p1",
    name: "GovernedVault",
    recipe: governedVault,
    layout: { ERC20: { x: 40, y: 80, pins: "left" } },
    deploy: { path: "factory", entropy: `0x${"0a".repeat(11)}`, scope: "this-chain" },
    provenance: {},
    predicted: [],
  };
  const deployment = {
    projectId: "p1",
    chainId: 11155111,
    address: ADDRESS,
    path: "createx",
    deployer: ADDRESS,
    salt: HASH,
    status: "proposed",
    safeTxHash: HASH,
    recipeHash: HASH,
    catalogHash: HASH,
    at: "2026-09-23T10:00:00.000Z",
    verification: "pending",
    revision: 1,
  };

  test("a project parses; entropy is exactly 11 bytes", () => {
    expect(validateProject(project).ok).toBe(true);
    const [issue] = issues(validateProject({ ...project, deploy: { ...project.deploy, entropy: `0x${"0a".repeat(12)}` } }));
    expect(issue?.path).toBe("deploy.entropy");
  });

  test("a mixed-case address must carry its checksum", () => {
    const wrong = "0x5FbDB2315678afecb367f032d93F642f64180aA3";
    const [issue] = issues(validateProject({ ...project, predicted: [{ chainId: 1, address: wrong }] }));
    expect(issue).toEqual({ path: "predicted[0].address", message: `is "${wrong}"; its EIP-55 checksum doesn't match.` });
    expect(validateProject({ ...project, predicted: [{ chainId: 1, address: ADDRESS.toLowerCase() }] }).ok).toBe(true);
  });

  test("a deployment record parses, and its status is one of the five", () => {
    expect(validateDeployment(deployment).ok).toBe(true);
    const [issue] = issues(validateDeployment({ ...deployment, status: "live" }));
    expect(issue).toEqual({
      path: "status",
      message: 'is "live"; expected "pending", "proposed", "confirmed", "mismatch" or "failed".',
    });
  });

  test("a project file parses and lists unknown fields by full path", () => {
    const result = validateProjectFile({ project: { ...project, extra: 1 }, deployments: [{ ...deployment, note: "x" }] });
    expect(result.ok && result.value.unknownFields).toEqual(["project.extra", "deployments[0].note"]);
  });

  test("the recipe inside a project reports its own path", () => {
    const [issue] = issues(validateProject({ ...project, recipe: { ...governedVault, facets: [1] } }));
    expect(issue?.path).toBe("recipe.facets[0]");
  });
});

describe("catalog files", () => {
  test("the manifest parses", () => {
    expect(
      validateCatalogManifest({
        default: "v0.4.0",
        catalogs: [{ id: "v0.4.0", tag: "v0.4.0", commit: "05004d4", hash: HASH, path: "catalog/v0.4.0" }],
      }).ok,
    ).toBe(true);
  });

  test("a facet shard parses with a solc-shaped ABI and rejects anything else", () => {
    const detail = {
      name: "ERC20",
      abi: [
        { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable" },
        { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }], anonymous: false },
        { type: "error", name: "ERC20InsufficientBalance", inputs: [{ name: "sender", type: "address" }] },
        { type: "receive", stateMutability: "payable" },
      ],
      natspec: { notice: "Token", functions: { "0xa9059cbb": { notice: "Moves tokens", params: { to: "Recipient" } } } },
      storageLayout: { storage: [] },
      source: { path: "src/tokens/ERC20.sol", url: "https://github.com/dadadave80/lattice/blob/f4a32c8/src/tokens/ERC20.sol" },
    };
    expect(validateFacetDetail(detail).ok).toBe(true);
    const [issue] = issues(validateFacetDetail({ ...detail, abi: [{ type: "function", name: "x" }] }));
    expect(issue?.path).toBe("abi[0]");
    expect(AbiItemSchema.safeParse({ type: "error", name: "E", inputs: [{ type: 1 }] }).success).toBe(false);
  });
});

describe("paths", () => {
  test("paths render like facets[3] and owners[\"0x…\"]", () => {
    expect(formatPath([])).toBe("");
    expect(formatPath(["facets", 3])).toBe("facets[3]");
    expect(formatPath(["init", "steps", 2, "args", "admin"])).toBe("init.steps[2].args.admin");
    expect(formatPath(["owners", "0xcdfe7f5c"])).toBe('owners["0xcdfe7f5c"]');
    expect(formatPath(["layout", "My facet"])).toBe('layout["My facet"]');
  });

  test("validate and listUnknownFields work on any schema", () => {
    const schema = z.looseObject({ a: z.string(), b: z.exactOptional(z.array(z.looseObject({ c: z.number() }))) });
    expect(validate(schema, { a: 1 })).toEqual({ ok: false, error: [{ path: "a", message: "is 1; expected text." }] });
    expect(listUnknownFields(schema, { a: "x", b: [{ c: 1, d: 2 }], e: 3 })).toEqual(["b[0].d", "e"]);
  });
});
