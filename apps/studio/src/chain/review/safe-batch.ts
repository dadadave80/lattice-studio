/**
 * Download Transaction Builder batch (IR L237, spec L580): with a Safe as the deployer, the review saves C7c's
 * batch for that Safe and chain, then hands the deploy controller `proposed({ safe, chainId, address, salt })`
 * so the record is saved as Proposed. Loaded on first use, never in the entry chunk.
 */
import type { Address, AnalysisContext, Hex } from "@lattice-studio/core";
import { exportSafeBatch, safeBatchTarget, toChecksum } from "@lattice-studio/core";
import {
  announce, chainService, deployController, env, listDeployments, loadCreationCode, log, now, type CommandContext,
} from "@/contracts";
import { chainName } from "@/chain/infra/chains";
import { saveFile } from "./save-file";
import { STUDIO_VERSION } from "./version";

function say(text: string, tag: "Note" | "Deploy" | "Error" = "Note"): void {
  log({ tag, text });
  announce(text, tag === "Error" ? { politeness: "assertive" } : {});
}

/** The project's known addresses and argument sources, as S1 builds them for AUTH-02 and LINK-01 (spec L333-L334). */
async function exportContext(ctx: CommandContext): Promise<Pick<AnalysisContext, "known" | "unconfirmed" | "knownFrom" | "unconfirmedFrom">> {
  const known: Address[] = [];
  const knownFrom: NonNullable<AnalysisContext["knownFrom"]> = {};
  const add = (address: Address, source: "prediction" | "deployment", chainId: number) => {
    const key = address.toLowerCase();
    if (!knownFrom[key]) known.push(toChecksum(address));
    if (!knownFrom[key] || source === "deployment") knownFrom[key] = { source, chainId, chain: chainName(chainId, env.e2e) };
  };
  for (const p of ctx.project.predicted) add(p.address, "prediction", p.chainId);
  // Every record counts, whatever its status (a verified diamond is still "confirmed", core model/project.ts).
  for (const d of await listDeployments(ctx.project.id)) add(d.address, "deployment", d.chainId);
  const unconfirmedFrom: Record<string, "link" | "file"> = {};
  for (const [path, source] of Object.entries(ctx.project.provenance)) {
    if (source === "link" || source === "file") unconfirmedFrom[path] = source;
  }
  return { known, knownFrom, unconfirmed: Object.keys(unconfirmedFrom).sort(), unconfirmedFrom };
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
  const { entropy, scope, path } = project.deploy;
  let proxyCreationCode: Hex | undefined;
  if (path === "createx") {
    const code = await loadCreationCode("Lattice");
    if (!code.ok) {
      say(code.error, "Error");
      return;
    }
    proxyCreationCode = code.value;
  }
  const readiness = service.readiness(chainId);
  const file = exportSafeBatch({
    recipe: project.recipe,
    catalog,
    safe,
    chainId,
    entropy,
    scope,
    path,
    now: now(),
    studioVersion: STUDIO_VERSION,
    context: await exportContext(ctx),
    ...(readiness.status === "ready" ? { chain: readiness.state } : {}),
    ...(proxyCreationCode === undefined ? {} : { proxyCreationCode }),
  });
  if (!file.ok) {
    say(file.error, "Error");
    return;
  }
  const target = safeBatchTarget({ catalog, safe, chainId, entropy, scope, path });
  if (!target.ok) {
    say(target.error, "Error");
    return;
  }
  saveFile(file.value);
  const controller = await deployController();
  controller.proposed({ safe, chainId, address: target.value.address, salt: target.value.salt });
  say(`Saved ${file.value.filename}. Import it in the Safe's Transaction Builder; this deploy is Proposed until the diamond appears at ${target.value.address}.`, "Deploy");
}
