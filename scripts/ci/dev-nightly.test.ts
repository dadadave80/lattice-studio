import { describe, expect, test } from "bun:test";
import {
  createNightlyVersion,
  npmCommand,
  queryNightlyVersion,
  stageNightlyVersion,
  validateNightlySource,
  type CommandResult,
  type NpmRunner,
} from "./dev-nightly.ts";

const sha = "c4a42a87bbd0b4683507d61679c9920c9b7b8b08";
const version = `0.2.0-dev.1794443077.g${sha}`;
const source = {
  eventName: "workflow_dispatch",
  ref: "refs/heads/dev",
  sha,
  head: sha,
};
const absent = { exitCode: 1, stdout: JSON.stringify({ error: { code: "E404" } }), stderr: "" };

function ok(value: unknown): CommandResult {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

function staged(tag = "dev"): unknown[] {
  return [{ id: "stage-id", packageName: "lattice-studio", version, tag }];
}

function fixture(results: CommandResult[]): { run: NpmRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run(args) {
      calls.push([...args]);
      const result = results[calls.length - 1];
      if (!result) throw new Error("Unexpected npm command in fixture.");
      return result;
    },
  };
}

describe("nightly source and version", () => {
  test("accepts only the exact dispatched dev commit", () => {
    expect(validateNightlySource(source)).toBe(sha);
    for (const invalid of [
      { eventName: "pull_request" },
      { eventName: "workflow_run" },
      { ref: "refs/heads/main" },
      { ref: "refs/tags/lattice-studio-v0.2.0" },
      { sha: sha.slice(0, 7) },
      { sha: `${sha}\n` },
      { sha: "g".repeat(40) },
      { sha: undefined },
      { head: "a".repeat(40) },
    ]) expect(() => validateNightlySource({ ...source, ...invalid })).toThrow();
  });

  test("derives an immutable version from the base, commit time, and full SHA", () => {
    expect(createNightlyVersion("0.2.0", "1794443077", sha)).toBe(version);
    expect(createNightlyVersion("0.2.0-rc.1+metadata", "1794443077", sha)).toBe(version);
    expect(createNightlyVersion(version, "1794443077", sha)).toBe(version);
    expect(createNightlyVersion("0.3.0", "1794443077", sha)).not.toBe(version);
    expect(createNightlyVersion("0.2.0", "1794443078", sha)).not.toBe(version);
    expect(createNightlyVersion("0.2.0", "1794443077", "a".repeat(40))).not.toBe(version);
  });

  test("rejects malformed manifest versions and commit times", () => {
    for (const invalid of ["0.2", "v0.2.0", "01.2.0", "0.2.0\n", "0.2.0-"]) {
      expect(() => createNightlyVersion(invalid, "1794443077", sha)).toThrow();
    }
    for (const invalid of ["", "0", "-1", "1.2", "01794443077", "1794443077\n"]) {
      expect(() => createNightlyVersion("0.2.0", invalid, sha)).toThrow();
    }
    expect(() => createNightlyVersion("0.2.0", "1794443077", "short")).toThrow();
  });

  test("runs the isolated npm CLI through the current Bun executable", () => {
    expect(npmCommand("/runner/temp", ["stage", "list", "lattice-studio", "--json"])).toEqual([
      process.execPath,
      "/runner/temp/npm-cli/node_modules/npm/bin/npm-cli.js",
      "stage", "list", "lattice-studio", "--json",
    ]);
    expect(() => npmCommand(undefined, [])).toThrow("RUNNER_TEMP");
    expect(() => npmCommand("relative", [])).toThrow("RUNNER_TEMP");
  });
});

describe("nightly registry lookup", () => {
  test("recognizes a pending dev stage and checks publication too", () => {
    const { run, calls } = fixture([ok(staged()), absent]);
    expect(queryNightlyVersion(version, run)).toBe(true);
    expect(calls).toEqual([
      ["stage", "list", "lattice-studio", "--json"],
      ["view", `lattice-studio@${version}`, "version", "--json"],
    ]);
  });

  test("recognizes an approved version after it leaves the staging list", () => {
    const { run } = fixture([ok([]), ok(version)]);
    expect(queryNightlyVersion(version, run)).toBe(true);
  });

  test("ignores stages for other versions", () => {
    const { run } = fixture([ok([{ packageName: "lattice-studio", version: "0.2.0", tag: "latest" }]), absent]);
    expect(queryNightlyVersion(version, run)).toBe(false);
  });

  test("rejects an exact staged version under another tag", () => {
    const { run } = fixture([ok(staged("latest")), absent]);
    expect(() => queryNightlyVersion(version, run)).toThrow("dev");
  });

  test("only an explicit structured view E404 proves absence", () => {
    for (const response of [
      { exitCode: 1, stdout: "", stderr: "E404" },
      { exitCode: 1, stdout: "not JSON", stderr: "" },
      { exitCode: 1, stdout: JSON.stringify({ error: { code: "E401" } }), stderr: "" },
      { exitCode: 1, stdout: JSON.stringify({ error: { code: "ECONNRESET" } }), stderr: "" },
      ok({ error: { code: "E404" } }),
      ok(null),
      ok([]),
      ok("0.2.0"),
    ]) {
      const { run } = fixture([ok([]), response]);
      expect(() => queryNightlyVersion(version, run)).toThrow();
    }
    const { run } = fixture([ok([]), absent]);
    expect(queryNightlyVersion(version, run)).toBe(false);
  });

  test("handles the first-ever package when both stage list and view return structured E404", () => {
    const { run } = fixture([absent, absent]);
    expect(queryNightlyVersion(version, run)).toBe(false);
  });

  test("fails closed on stage-list failures or malformed schemas", () => {
    for (const response of [
      { exitCode: 1, stdout: JSON.stringify({ error: { code: "E401" } }), stderr: "" },
      { exitCode: 1, stdout: "", stderr: "E404" },
      { exitCode: 1, stdout: JSON.stringify({ error: { code: "ECONNRESET" } }), stderr: "" },
      ok({ error: { code: "E404" } }),
      { exitCode: 0, stdout: "not JSON", stderr: "" },
      ok({ items: staged() }),
      ok([null]),
      ok([{ packageName: "lattice-studio", version }]),
      ok([{ packageName: "lattice-studio", version, tag: null }]),
    ]) {
      const { run } = fixture([response, absent]);
      expect(() => queryNightlyVersion(version, run)).toThrow();
    }
  });
});

describe("nightly staging", () => {
  test("requires the version computed from the checked-out commit before any upload", () => {
    const { run, calls } = fixture([]);
    for (const supplied of [undefined, "0.2.0", `${version}\n`]) {
      expect(() => stageNightlyVersion(version, supplied, run, version)).toThrow("NIGHTLY_VERSION");
    }
    expect(calls).toEqual([]);
  });

  test("rejects a stable or unrelated prerelease manifest before any npm command", () => {
    const { run, calls } = fixture([]);
    for (const manifestVersion of ["0.2.0", "0.2.0-rc.1", `0.2.0-dev.1794443078.g${sha}`]) {
      expect(() => stageNightlyVersion(version, version, run, manifestVersion)).toThrow("CLI manifest version");
    }
    expect(calls).toEqual([]);
  });

  test("stages with provenance, public access, and the dev tag", () => {
    const { run, calls } = fixture([ok({ "lattice-studio": { name: "lattice-studio", version, stageId: "stage-id" } })]);
    expect(stageNightlyVersion(version, version, run, version)).toBe("staged");
    expect(calls).toEqual([["stage", "publish", "--provenance", "--access", "public", "--tag", "dev", "--json"]]);
  });

  test("recovers an interrupted upload response only after exact registry confirmation", () => {
    const { run, calls } = fixture([
      { exitCode: 1, stdout: JSON.stringify({ error: { code: "ECONNRESET" } }), stderr: "" },
      ok(staged()),
      absent,
    ]);
    expect(stageNightlyVersion(version, version, run, version)).toBe("confirmed");
    expect(calls).toHaveLength(3);
  });

  test("also recovers when approval completed before the confirmation query", () => {
    const { run } = fixture([{ exitCode: 0, stdout: "", stderr: "" }, ok([]), ok(version)]);
    expect(stageNightlyVersion(version, version, run, version)).toBe("confirmed");
  });

  test("does not accept a dry run or an unrelated success object without confirmation", () => {
    for (const response of [
      ok({ "lattice-studio": { name: "lattice-studio", version } }),
      ok({ "lattice-studio": { name: "lattice-studio", version: "0.2.0", stageId: "stage-id" } }),
      { exitCode: 0, stdout: "not JSON", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "" },
    ]) {
      const { run } = fixture([response, ok([]), absent]);
      expect(() => stageNightlyVersion(version, version, run, version)).toThrow("not confirmed");
    }
  });

  test("fails closed when a recovery lookup errors or finds the wrong tag", () => {
    for (const response of [
      { exitCode: 1, stdout: JSON.stringify({ error: { code: "E401" } }), stderr: "" },
      ok(staged("latest")),
    ]) {
      const { run } = fixture([{ exitCode: 1, stdout: "", stderr: "" }, response, absent]);
      expect(() => stageNightlyVersion(version, version, run, version)).toThrow("confirmation failed");
    }
  });

  test("recovers a thrown upload error without sending another upload", () => {
    const { run, calls } = fixture([ok(staged()), absent]);
    const uploadCalls: string[][] = [];
    const interrupted: NpmRunner = (args) => {
      if (args[1] === "publish") {
        uploadCalls.push([...args]);
        throw new Error("Response interrupted.");
      }
      return run(args);
    };
    expect(stageNightlyVersion(version, version, interrupted, version)).toBe("confirmed");
    expect(uploadCalls).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});
