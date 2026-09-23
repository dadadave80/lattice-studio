import { NotImplemented, type CommandId } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { command, provideServices } from "@/contracts";
import { fakeChainService, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../../../../test/harness";
import { PreviewView } from "./PreviewView";

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;

function spy(id: CommandId) {
  const run = vi.fn();
  overrideCommands([command({ id, title: () => id, category: "Build", enabled: () => ({ ok: true }), run })]);
  return run;
}

function project(facets: string[], id: string) {
  return makeProject({ id, recipe: makeRecipe({ facets }, fixtureCatalog()) });
}

function availability(chainId: number): string {
  return document.querySelector(`[data-chain="${chainId}"]`)?.textContent ?? "";
}

describe("catalog preview", () => {
  test("the facet as the Facet view shows it, read-only, with Place on sheet", async () => {
    const place = spy("facet.place");
    await renderWithStudio(<PreviewView view={{ kind: "preview", facet: "ERC4626" }} />, { project: project([], "preview-plain") });
    await expect.element(page.getByRole("heading", { level: 2, name: "ERC4626" })).toBeVisible();
    await expect.element(page.getByText("Catalog preview")).toBeVisible();
    // Read-only: the selector rows are text, and none of the Facet view's actions show.
    const rows = document.querySelectorAll("[data-selector]");
    expect(rows.length).toBe(17);
    expect(Array.from(rows).every((row) => row.tagName !== "BUTTON")).toBe(true);
    for (const name of ["Flip pins", "Locate", "Remove", "Move step up"]) {
      expect(page.getByRole("button", { name }).elements().length).toBe(0);
    }
    await page.getByRole("button", { name: "Place on sheet" }).click();
    expect(place).toHaveBeenCalledTimes(1);
    expect(place.mock.calls[0]?.[1]).toEqual({ facet: "ERC4626" });
  });

  test("availability waits for a chain to be chosen", async () => {
    await renderWithStudio(<PreviewView view={{ kind: "preview", facet: "ERC20" }} />, { project: project([], "preview-nochain") });
    await expect.element(page.getByText("Choose a chain to see availability.")).toBeVisible();
  });

  test("offline, availability is unknown", async () => {
    onCleanup(provideServices({ connection: { isOnline: () => false, subscribe: () => () => {} } }));
    await renderWithStudio(<PreviewView view={{ kind: "preview", facet: "ERC20" }} />, {
      project: project([], "preview-offline"),
      session: { chainId: SEPOLIA },
      chain: true,
    });
    await expect.element(page.getByText("Offline, availability is unknown.")).toBeVisible();
  });

  test("per chain: not checked yet, available once probed, or not on that chain", async () => {
    const chain = fakeChainService({ state: { [BASE_SEPOLIA]: { shared: {} } } });
    await renderWithStudio(<PreviewView view={{ kind: "preview", facet: "ERC20" }} />, {
      project: project([], "preview-chains"),
      session: { chainId: SEPOLIA },
      chain,
    });
    await vi.waitFor(() => expect(availability(SEPOLIA)).toBe("Not checked yet"));
    expect(availability(BASE_SEPOLIA)).toBe("Not checked yet");
    await chain.probe(SEPOLIA);
    await chain.probe(BASE_SEPOLIA);
    await vi.waitFor(() => expect(availability(SEPOLIA)).toBe("Available"));
    await vi.waitFor(() => expect(availability(BASE_SEPOLIA)).toBe("Not on Base Sepolia"));
  });

  test("while the chain module isn't built, it says so", async () => {
    onCleanup(provideServices({ chain: () => Promise.reject(new NotImplemented("S8a", "chainService")) }));
    await renderWithStudio(<PreviewView view={{ kind: "preview", facet: "ERC20" }} />, {
      project: project([], "preview-nomodule"),
      session: { chainId: SEPOLIA },
    });
    await expect.element(page.getByText("Not built yet · WP-S8a")).toBeVisible();
  });
});

describe("compare options", () => {
  test("two or more options sit side by side, each with Place {name}", async () => {
    const place = spy("facet.place");
    await renderWithStudio(
      <PreviewView view={{ kind: "preview", facet: "ERC20", compare: ["ERC20", "ERC4626"] }} />,
      { project: project(["VaultCore"], "preview-compare") },
    );
    await expect.element(page.getByRole("heading", { level: 2, name: "Compare options" })).toBeVisible();
    const columns = document.querySelectorAll("[data-option]");
    expect(Array.from(columns).map((c) => (c as HTMLElement).dataset.option)).toEqual(["ERC20", "ERC4626"]);
    await expect.element(page.getByRole("region", { name: "ERC4626" }).getByText("17 selectors")).toBeVisible();
    await page.getByRole("region", { name: "ERC4626" }).getByRole("button").click();
    expect(place.mock.calls[0]?.[1]).toEqual({ facet: "ERC4626" });
  });

  test("an option the catalog doesn't have says so", async () => {
    await renderWithStudio(
      <PreviewView view={{ kind: "preview", facet: "ERC20", compare: ["ERC20", "Nope"] }} />,
      { project: project([], "preview-unknown") },
    );
    await expect.element(page.getByText("Nope isn't in the catalog.")).toBeVisible();
  });
});
