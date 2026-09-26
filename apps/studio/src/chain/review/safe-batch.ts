/**
 * Download Transaction Builder batch (IR L237, spec L580): with a Safe as the deployer, the review saves C7c's
 * batch for that Safe and chain, then hands the deploy controller `proposed({ safe, chainId, address, salt })`
 * so the record is saved as Proposed. Loaded on first use, never in the entry chunk.
 */
import type { Address, AnalysisContext, Catalog, ExportFile, Hex, Project, Result } from "@lattice-studio/core";
import { exportSafeBatch, safeBatchTarget, toChecksum } from "@lattice-studio/core";
import {
  announce, chainService, deployController, listDeployments, loadCreationCode, log, now, type ChainService, type CommandContext,
} from "@/contracts";
import { exportRecipe } from "@/panels/console/exporters/recipe";
import { saveFile } from "./save-file";
import { STUDIO_VERSION } from "./version";

function say(text: string, tag: "Note" | "Deploy" | "Error" = "Note"): void {
  log({ tag, text });
  announce(text, tag === "Error" ? { politeness: "assertive" } : {});
}

/** The project's known addresses and argument sources, as S1 builds them for AUTH-02 and LINK-01 (spec L333-L334). */
async function exportContext(project: Project, chainName: (id: number) => string): Promise<Pick<AnalysisContext, "known" | "unconfirmed" | "knownFrom" | "unconfirmedFrom">> {
  const known: Address[] = [];
  const knownFrom: NonNullable<AnalysisContext["knownFrom"]> = {};
  const add = (address: Address, source: "prediction" | "deployment", chainId: number) => {
    const key = address.toLowerCase();
    if (!knownFrom[key]) known.push(toChecksum(address));
    if (!knownFrom[key] || source === "deployment") knownFrom[key] = { source, chainId, chain: chainName(chainId) };
  };
  for (const p of project.predicted) add(p.address, "prediction", p.chainId);
  // Every record counts, whatever its status (a verified diamond is still "confirmed", core model/project.ts).
  for (const d of await listDeployments(project.id)) add(d.address, "deployment", d.chainId);
  const unconfirmedFrom: Record<string, "link" | "file"> = {};
  for (const [path, source] of Object.entries(project.provenance)) {
    if (source === "link" || source === "file") unconfirmedFrom[path] = source;
  }
  return { known, knownFrom, unconfirmed: Object.keys(unconfirmedFrom).sort(), unconfirmedFrom };
}

export type SafeBatchBuild = { file: ExportFile; address: Address; salt: Hex };

/**
 * Everything the download needs before it touches the DOM: the batch file, stamped with the project's name
 * (spec L212) through `exportRecipe`, and the address and salt it deploys to. Exported so it's testable without
 * a browser; `downloadSafeBatch` is the app's only caller.
 */
export async function buildSafeBatch(
  project: Project,
  catalog: Catalog,
  service: Pick<ChainService, "chains" | "readiness">,
  safe: Address,
  chainId: number,
): Promise<Result<SafeBatchBuild, string>> {
  const { entropy, scope, path } = project.deploy;
  let proxyCreationCode: Hex | undefined;
  if (path === "createx") {
    const code = await loadCreationCode("Lattice");
    if (!code.ok) return { ok: false, error: `Couldn't load the Lattice proxy's creation code: ${code.error}` };
    proxyCreationCode = code.value;
  }
  const readiness = service.readiness(chainId);
  const file = exportSafeBatch({
    recipe: exportRecipe(project),
    catalog,
    safe,
    chainId,
    entropy,
    scope,
    path,
    now: now(),
    studioVersion: STUDIO_VERSION,
    context: await exportContext(project, (id) => service.chains().find((c) => c.id === id)?.name ?? `Chain ${id}`),
    ...(readiness.status === "ready" ? { chain: readiness.state } : {}),
    ...(proxyCreationCode === undefined ? {} : { proxyCreationCode }),
  });
  if (!file.ok) return file;
  const target = safeBatchTarget({ catalog, safe, chainId, entropy, scope, path });
  if (!target.ok) return target;
  return { ok: true, value: { file: file.value, address: target.value.address, salt: target.value.salt } };
}

export async function downloadSafeBatch(ctx: CommandContext): Promise<void> {
  const { project, catalog } = ctx;
  const chainId = ctx.session.chainId;
  if (!catalog || chainId === null) return;
  const service = await chainService();
  const account = service.account();
  if (!account || account.kind !== "safe") {
    say("The connected account isn't a Safe. Export → Safe batch takes any Safe's address.");
    return;
  }
  const safe = toChecksum(account.address);
  const built = await buildSafeBatch(project, catalog, service, safe, chainId);
  if (!built.ok) {
    say(built.error, "Error");
    return;
  }
  saveFile(built.value.file);
  const controller = await deployController();
  controller.proposed({ safe, chainId, address: built.value.address, salt: built.value.salt });
  say(`Saved ${built.value.file.filename}. Import it in the Safe's Transaction Builder; this deploy is Proposed until the diamond appears at ${built.value.address}.`, "Deploy");
}
