import type { Address } from "@lattice-studio/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, doc, getAnalysis, provideDeployController, session, type DeployController, type DeployState } from "@/contracts";
import { listVerbs } from "@/commands/console/router";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { COMMAND_LABEL } from "./CommandLine";
import { ConsolePanel } from "./ConsolePanel";
import { logEntries } from "./log-store";
import { awaitConsoleBody, captureDownloads, collisionProject, erc20Project, recordLocate, resetConsole } from "./test-support";

beforeEach(() => resetConsole());

const input = () => page.getByRole("textbox", { name: COMMAND_LABEL });
const texts = () => logEntries().map((e) => e.text);

async function renderConsole(project = erc20Project()) {
  const rendered = await renderWithStudio(<div style={{ height: "400px", display: "flex" }}><ConsolePanel /></div>, { project });
  await awaitConsoleBody();
  return rendered;
}

async function run(line: string) {
  await userEvent.fill(input(), line);
  await userEvent.keyboard("{Enter}");
}

/** Waits until a line matching `text` is in the log. */
async function logged(text: string | RegExp | ((line: string) => boolean)) {
  const match = (t: string) => (typeof text === "string" ? t === text : typeof text === "function" ? text(t) : text.test(t));
  await vi.waitFor(() => expect(texts().some(match), `a line matching ${String(text)} in:\n${texts().join("\n")}`).toBe(true));
}

describe("command line (IR L137)", () => {
  test("each command is echoed, then runs through the registry", async () => {
    await renderConsole();
    await run("place ERC20Permit");
    const echo = logEntries().find((e) => e.text === "› place ERC20Permit");
    expect(echo?.dim).toBe(true);
    await logged(/^Placed ERC20Permit · \d+ selectors/);
    expect(doc.get().recipe.facets).toContain("ERC20Permit");
    await expect.element(input()).toHaveValue("");
  });

  test("unknown input suggests the nearest verb, or just says so", async () => {
    await renderConsole();
    await run("plce erc20");
    await logged("“plce” isn't a command. Did you mean place? Type help for commands.");
    await run("xyzzy");
    await logged("“xyzzy” isn't a command. Type help for commands.");
    // A known verb with arguments it can't take is the command's to answer.
    await run("problems now");
    await logged("problems takes no arguments: problems");
  });

  test("help lists the verbs; help <verb> explains every form of each one", async () => {
    await renderConsole();
    await run("help");
    const verbs = listVerbs().map((v) => v.verb);
    for (const verb of ["clear", "help", "find", "problems", "export", "place", "route"]) expect(verbs).toContain(verb);
    await logged(`Commands: ${verbs.join(", ")}. Type help <verb> for one.`);
    // Every verb the registry has answers help with its forms.
    for (const v of listVerbs()) {
      await run(`help ${v.verb}`);
      for (const form of v.forms) await logged((t: string) => t.startsWith(form.syntax));
    }
    await run("help export");
    for (const syntax of ["export foundry", "export brief", "export json", "export safe [Safe address] [chain]"]) {
      await logged(new RegExp(`^${syntax.replace(/[[\]]/g, "\\$&")}`));
    }
    await run("help expotr");
    await logged("“expotr” isn't a command. Did you mean export? Type help for commands.");
  });

  test("every registered verb answers when typed bare: it runs, or says what it needs", async () => {
    await renderConsole();
    const verbs = listVerbs().map((v) => v.verb);
    expect(verbs.length).toBeGreaterThan(10);
    for (const verb of verbs) {
      resetConsole();
      doc.load(erc20Project());
      await run(verb);
      if (verb === "clear") {
        await vi.waitFor(() => expect(logEntries()).toEqual([]));
        continue;
      }
      // The echo, then at least one line from the router or the command.
      await vi.waitFor(() => expect(texts().length, `${verb} said nothing:\n${texts().join("\n")}`).toBeGreaterThanOrEqual(2));
      expect(texts()[0]).toBe(`› ${verb}`);
    }
  });

  test("problems lists them as lines, blockers first, each locatable", async () => {
    await renderConsole(collisionProject());
    await run("problems");
    await logged(/^2 blockers · 1 warning/);
    const collisions = logEntries().filter((e) => e.tag === "Collision");
    expect(collisions.map((e) => e.text.slice(0, 18))).toEqual(["Blocker · SEL-01 ·", "Blocker · SEL-01 ·"]);
    expect(collisions[0]?.anchor).toEqual({ kind: "selector", selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter" });
  });

  test("find selects and locates matching facets and pins, and says how many", async () => {
    const located = recordLocate();
    await renderConsole();
    await run("find erc20");
    await logged("Found 1 facet matching ‘erc20’. Selected ERC20.");
    expect(session.get().selection[0]).toBe("ERC20");
    expect(located[0]).toEqual({ facet: "ERC20" });
    await run("find 0x313ce567");
    await logged("Found 1 pin matching ‘0x313ce567’: `decimals · 0x313ce567` on ERC20. Selected ERC20.");
    expect(located.at(-1)).toEqual({ facet: "ERC20", selector: "0x313ce567" });
    await run("find nothing here");
    await logged("Nothing on the sheet matches ‘nothing here’.");
    await run("find");
    await logged("Name what to find: find <text or 0x…>");
  });

  test("clear empties the log, and Ctrl L does on macOS", async () => {
    onCleanup(overridePlatform("mac"));
    await renderConsole();
    await run("problems");
    await logged("1 warning.");
    await run("clear");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
    await run("problems");
    await logged("1 warning.");
    await userEvent.click(input());
    await userEvent.keyboard("{Control>}l{/Control}");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
  });

  test("↑ ↓ walk the history and come back to the draft", async () => {
    await renderConsole();
    await run("help");
    await run("problems");
    await userEvent.fill(input(), "fin");
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(input()).toHaveValue("problems");
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(input()).toHaveValue("help");
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(input()).toHaveValue("help");
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(input()).toHaveValue("problems");
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(input()).toHaveValue("fin");
  });

  test("Esc clears a typed line, then runs ui.escape", async () => {
    const escapes: string[] = [];
    overrideCommands([
      command({ id: "ui.escape", title: () => "Escape", category: "Session", enabled: () => ({ ok: true }), run: () => void escapes.push("esc") }),
    ]);
    await renderConsole();
    await userEvent.fill(input(), "place erc");
    await userEvent.keyboard("{Escape}");
    await expect.element(input()).toHaveValue("");
    expect(escapes).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(escapes).toEqual(["esc"]));
  });

  test("Tab accepts a visible suggestion; otherwise it moves focus", async () => {
    await renderConsole();
    await userEvent.fill(input(), "probl");
    await expect.element(page.getByText("Tab: problems")).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.element(input()).toHaveValue("problems ");
    await expect.element(input()).toHaveFocus();
    await userEvent.fill(input(), "export f");
    await userEvent.keyboard("{Tab}");
    await expect.element(input()).toHaveValue("export foundry");
    await userEvent.fill(input(), "export foundry now");
    await userEvent.keyboard("{Tab}");
    await expect.element(input()).not.toHaveFocus();
  });
});

describe("console verbs for exports", () => {
  test("export foundry opens the Script tab maximized; export json opens Recipe JSON", async () => {
    await renderConsole();
    await run("export foundry");
    await vi.waitFor(() => expect(session.get().panes.console).toMatchObject({ tab: "script", maximized: true, open: true }));
    await run("export json");
    await vi.waitFor(() => expect(session.get().panes.console.tab).toBe("recipe"));
  });

  test("export brief downloads it and logs the export; blockers stop the script with the reason", async () => {
    const files = captureDownloads();
    await renderConsole();
    await run("export brief");
    await vi.waitFor(() => expect(files.map((f) => f.filename)).toEqual(["erc20.brief.md"]));
    await logged(/^Exported erc20\.brief\.md · recipe 0x[0-9a-f]{4}…[0-9a-f]{4}$/);

    doc.load(collisionProject());
    await run("export foundry");
    await logged("Resolve 2 blockers to export · F8");
    expect(session.get().panes.console.tab).toBe("log");
  });

  test("export safe with an address and chain downloads the batch and records it as Proposed", async () => {
    const proposals: Parameters<DeployController["proposed"]>[0][] = [];
    const state: DeployState = { phase: "idle" };
    const controller = {
      state: () => state, subscribe: () => () => {}, open() {}, changed() {}, sign: async () => {},
      proposed: (batch: Parameters<DeployController["proposed"]>[0]) => void proposals.push(batch),
      deployMissing: async () => {}, keepWaiting() {}, checkWallet() {}, reviewAgain() {}, discardProposal() {}, retry() {}, close() {},
    } satisfies DeployController;
    onCleanup(provideDeployController(async () => controller));
    const files = captureDownloads();
    const safe: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    await renderConsole();
    // The Safe batch waits for the review's acknowledgements (spec L573): tick every one the analysis raises.
    const analysis = getAnalysis();
    session.set({ acks: { [analysis.recipeHash]: analysis.problems.filter((p) => p.ack === true).map((p) => p.id) } });
    await run(`export safe ${safe.toLowerCase()} sepolia`);
    await vi.waitFor(() => expect(proposals).toHaveLength(1));
    expect(proposals[0]).toMatchObject({ safe, chainId: 11155111 });
    expect(proposals[0]?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(files[0]?.filename).toMatch(/\.safe\.json$/);
    const batch = JSON.parse(files[0]?.text ?? "{}") as { chainId: string; transactions: unknown[] };
    expect(batch.chainId).toBe("11155111");
    expect(batch.transactions).toHaveLength(1);

    await run("export safe");
    await vi.waitFor(() => expect(session.get().dialogs.map((d) => d.id)).toEqual(["safe-batch"]));
    await run("export safe 0x1234 sepolia");
    await logged("0x1234 isn't an address. Enter the Safe's full address.");
    await run(`export safe ${safe} mars`);
    await logged("mars isn't a chain Studio deploys to. Name one: sepolia, base-sepolia.");
  });
});
