/**
 * The Safe batch exporter's lazy chunk (spec L517, L580, L822): C7c's `exportSafeBatch`, byte for byte, with the
 * address and salt the batch deploys to (`safeBatchTarget`), so the record saved as Proposed names exactly that
 * diamond. The project's known addresses and argument sources come from S1's analysis context, so AUTH-02 and
 * LINK-01 refuse the batch as they refuse a deploy.
 */
import type {
  Address, AnalysisContext, Catalog, ExportFile, Hex, Project, Result, SafeBatchArgs,
} from "@lattice-studio/core";
import { exportSafeBatch, safeBatchTarget } from "@lattice-studio/core";
import { loadCreationCode } from "@/contracts";
import { studioState } from "@/state/runtime";
import { STUDIO_VERSION } from "./version";

export type SafeInput = { project: Project; catalog: Catalog; safe: Address; chainId: number; now: number };

export type SafeBatch = { file: ExportFile; address: Address; salt: Hex };

/** The open document's analysis context, or none when S1's state isn't installed. */
function documentContext(): AnalysisContext | null {
  try {
    return studioState().analysis.context();
  } catch {
    return null;
  }
}

export async function safeBatch({ project, catalog, safe, chainId, now }: SafeInput): Promise<Result<SafeBatch, string>> {
  const { path, scope, entropy } = project.deploy;
  const target = safeBatchTarget({ catalog, safe, chainId, entropy, scope, path });
  if (!target.ok) return target;
  let proxyCreationCode: Hex | undefined;
  if (path === "createx") {
    const code = await loadCreationCode("Lattice");
    if (!code.ok) return { ok: false, error: `Couldn't load the Lattice proxy's creation code: ${code.error}` };
    proxyCreationCode = code.value;
  }
  const ctx = documentContext();
  const context: NonNullable<SafeBatchArgs["context"]> = {
    known: ctx?.known ?? [],
    unconfirmed: ctx?.unconfirmed ?? [],
    ...(ctx?.knownFrom === undefined ? {} : { knownFrom: ctx.knownFrom }),
    ...(ctx?.unconfirmedFrom === undefined ? {} : { unconfirmedFrom: ctx.unconfirmedFrom }),
  };
  const chain = ctx?.chain?.chainId === chainId ? ctx.chain : undefined;
  const file = exportSafeBatch({
    recipe: project.recipe,
    catalog,
    safe,
    chainId,
    entropy,
    scope,
    path,
    now,
    studioVersion: STUDIO_VERSION,
    context,
    ...(chain === undefined ? {} : { chain }),
    ...(proxyCreationCode === undefined ? {} : { proxyCreationCode }),
  });
  if (!file.ok) return file;
  return { ok: true, value: { file: file.value, address: target.value.address, salt: target.value.salt } };
}
