import { describe, expect, test } from "bun:test";
import type { ProjectStatus } from "@lattice-studio/core";
import { chipWords, toneFor } from "./status";

const name = (id: number) => (id === 11155111 ? "Sepolia" : `Chain ${id}`);

const notDeployed: ProjectStatus = { state: "not-deployed", stamp: "Not deployed", chainId: 11155111, live: [], deployAgain: false };
const live: ProjectStatus = { state: "live", stamp: "Live · Sepolia · r1", chainId: 11155111, live: [], deployAgain: false };

describe("status chip", () => {
  test("takes the project's stamp and a tone for it", () => {
    expect(chipWords(notDeployed, { phase: "idle" }, name)).toEqual({ tone: "idle", text: "Not deployed" });
    expect(chipWords(live, { phase: "idle" }, name)).toEqual({ tone: "live", text: "Live · Sepolia · r1" });
    expect(toneFor("modified")).toBe("attention");
    expect(toneFor("proposed")).toBe("pending");
  });

  test("while a deploy is in flight, the controller's phase decides", () => {
    expect(chipWords(notDeployed, { phase: "pending", chainId: 11155111 }, name)).toEqual({
      tone: "pending", text: "Pending · Sepolia",
    });
    expect(chipWords(notDeployed, { phase: "proposed", chainId: 11155111 }, name)).toEqual({
      tone: "pending", text: "Proposed · Sepolia (Safe)",
    });
    expect(chipWords(notDeployed, { phase: "mismatch", chainId: 11155111 }, name)).toEqual({
      tone: "attention", text: "Mismatch · Sepolia",
    });
  });

  test("a review that hasn't sent anything leaves the stamp alone; a live record wins over verifying", () => {
    expect(chipWords(notDeployed, { phase: "review", chainId: 11155111 }, name).text).toBe("Not deployed");
    expect(chipWords(live, { phase: "verifying", chainId: 11155111 }, name).text).toBe("Live · Sepolia · r1");
  });
});
