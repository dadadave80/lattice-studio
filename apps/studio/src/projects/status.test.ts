import { describe, expect, test } from "bun:test";
import { recipeHash, type Deployment } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { projectRowStatus } from "./status";

const project = makeProject();

function confirmed(chainId: number): Deployment {
  return {
    projectId: project.id,
    chainId,
    address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    path: "factory",
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    salt: "0x01",
    status: "confirmed",
    verification: "match",
    revision: 1,
    recipeHash: recipeHash(project.recipe),
    catalogHash: project.recipe.catalog.hash,
    at: "2026-09-29T12:00:00.000Z",
  };
}

describe("projectRowStatus", () => {
  test("names the chain from the static table when the dialog hasn't loaded the chain module (Q1e's 'Chain 31337' chip)", () => {
    const { text } = projectRowStatus(project, [confirmed(11155111)]);
    expect(text).toContain("Sepolia");
    expect(text).not.toContain("Chain 11155111");
  });

  test("prefers the loaded names and reads 'Chain <id>' for a chain Studio doesn't list", () => {
    expect(projectRowStatus(project, [confirmed(11155111)], new Map([[11155111, "Sepolia (loaded)"]])).text).toContain("Sepolia (loaded)");
    expect(projectRowStatus(project, [confirmed(6)]).text).toContain("Chain 6");
  });
});
