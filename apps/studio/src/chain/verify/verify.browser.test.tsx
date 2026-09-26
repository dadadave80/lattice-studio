/**
 * The verify engine wired into the app: the watcher over a confirmed record, `deploy.retryVerification` (S5c's
 * Deployments list shows it only when a record's verification failed), against the real dev server's `/catalog/`
 * (the fixture catalog `seedStudio` loads, exactly where `standard-json.ts` reads it) with only Sourcify's own
 * network faked. `services.ts`'s auto-start stays off under Vitest; the watcher is started by hand.
 */
import { describe, expect, test, vi } from "vitest";
import type { Address, Deployment } from "@lattice-studio/core";
import { commandRef, listDeployments, putDeployment, runCommand } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { onCleanup, seedStudio } from "../../../test/harness";
import { SOURCIFY_BASE } from "./sourcify";
import { startVerifying } from "./watcher";

const CHAIN_ID = 11155111;
const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;

function confirmedRecord(projectId: string, overrides: Partial<Deployment> = {}): Deployment {
  return {
    projectId,
    chainId: CHAIN_ID,
    address: ADDRESS,
    path: "factory",
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
    salt: "0x0102030405060708090a0b0c0d0e0f10111213" as `0x${string}`,
    status: "confirmed",
    tx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
    recipeHash: "0x01" as `0x${string}`,
    catalogHash: "0x02" as `0x${string}`,
    at: "2026-09-23T12:00:00.000Z",
    verification: "pending",
    revision: 1,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Fakes Sourcify's own network; every other fetch (the catalog's real files) goes to the real `fetch`. */
function fakeSourcify(respond: (init: RequestInit | undefined) => Response | Promise<Response>): void {
  const original = globalThis.fetch.bind(globalThis);
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    return url.startsWith(SOURCIFY_BASE) ? respond(init) : original(input, init);
  });
  onCleanup(() => spy.mockRestore());
}

describe("the verify watcher", () => {
  test("verifies a confirmed record over the real catalog fetch, and logs Verified", async () => {
    const { project } = seedStudio();
    fakeSourcify((init) =>
      init?.method === "POST"
        ? jsonResponse(202, { verificationId: "job-1" })
        : jsonResponse(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } }),
    );
    await putDeployment(confirmedRecord(project.id));
    const stop = startVerifying();
    onCleanup(stop);

    await vi.waitFor(async () => {
      const [record] = await listDeployments(project.id);
      expect(record?.verification).toBe("exact_match");
    });
    expect(bufferedServices().log.map((l) => l.text)).toContain("Verified on Sourcify (exact match).");
  });

  test("leaves a mismatch record's verification alone: it never goes Live", async () => {
    const { project } = seedStudio();
    fakeSourcify(() => jsonResponse(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } }));
    await putDeployment(confirmedRecord(project.id, { status: "mismatch" }));
    const stop = startVerifying();
    onCleanup(stop);

    // Give the watcher a turn; a mismatch record was never eligible, so nothing to wait for settling.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [record] = await listDeployments(project.id);
    expect(record?.verification).toBe("pending");
  });
});

describe("deploy.retryVerification", () => {
  test("reopens a failed record and verifies it again", async () => {
    const { project } = seedStudio();
    let posts = 0;
    fakeSourcify((init) => {
      if (init?.method === "POST") {
        posts += 1;
        return jsonResponse(202, { verificationId: "job-2" });
      }
      return jsonResponse(200, { isJobCompleted: true, contract: { runtimeMatch: "match" } });
    });
    await putDeployment(confirmedRecord(project.id, { verification: "failed" }));

    const outcome = await runCommand(commandRef("deploy.retryVerification", { chainId: CHAIN_ID, address: ADDRESS }), "api");
    expect(outcome).toEqual({ ok: true });

    await vi.waitFor(async () => {
      const [record] = await listDeployments(project.id);
      expect(record?.verification).toBe("match");
    });
    expect(posts).toBe(1);
    expect(bufferedServices().log.map((l) => l.text)).toContain("Verified on Sourcify (match).");
  });

  test("says so, and touches nothing, when there's no such record", async () => {
    seedStudio();
    const outcome = await runCommand(commandRef("deploy.retryVerification", { chainId: 999, address: ADDRESS }), "api");
    expect(outcome).toEqual({ ok: true });
    expect(bufferedServices().log.map((l) => l.text)).toContain("Couldn't find that deployment record to retry.");
  });
});
