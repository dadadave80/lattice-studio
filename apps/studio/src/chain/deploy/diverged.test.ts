import { describe, expect, test } from "bun:test";
import type { Deployment, Hex } from "@lattice-studio/core";
import { divergedRecords } from "./diverged";

const A = `0x${"aa".repeat(32)}` as Hex;
const B = `0x${"bb".repeat(32)}` as Hex;

function record(patch: Partial<Deployment>): Deployment {
  return {
    projectId: "p1", chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", salt: `0x${"00".repeat(32)}`, status: "confirmed", recipeHash: A,
    catalogHash: `0x${"cc".repeat(32)}`, at: "2026-09-23T12:00:00.000Z", verification: "pending", revision: 1, ...patch,
  };
}

describe("divergedRecords (spec L728)", () => {
  test("an edit away from a live recipe: the chain it was live on, once", () => {
    const records = [record({}), record({ address: "0x1111111111111111111111111111111111111111", at: "2026-09-22T12:00:00.000Z" })];
    expect(divergedRecords(records, "p1", A, B).map((d) => d.chainId)).toEqual([11155111]);
  });

  test("nothing when another record is live for the new hash on that chain, or when nothing was live", () => {
    expect(divergedRecords([record({}), record({ address: "0x1111111111111111111111111111111111111111", recipeHash: B })], "p1", A, B)).toEqual([]);
    expect(divergedRecords([record({ status: "mismatch" })], "p1", A, B)).toEqual([]);
    expect(divergedRecords([record({ fromFile: true })], "p1", A, B)).toEqual([]);
    expect(divergedRecords([record({ projectId: "other" })], "p1", A, B)).toEqual([]);
  });

  test("one line per chain, in chain order", () => {
    const records = [record({ chainId: 84532 }), record({})];
    expect(divergedRecords(records, "p1", A, B).map((d) => d.chainId)).toEqual([84532, 11155111]);
  });
});
