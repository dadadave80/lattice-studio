/**
 * `predict --deployer <address> --chain <id> [--path]` (spec L921): the diamond's address for that account (a
 * Safe's too, without connecting it), from the salt in `--project`, or `--entropy` and `--scope`, or fresh
 * entropy that's printed. Offline: the address follows from the account, the salt, the chain and the catalog.
 */
import type { Project } from "@lattice-studio/core";
import type { Parsed } from "../args";
import type { Deps } from "../deps";
import { freshEntropyNote, parseAddress, parseChainId, predictDiamond, resolveDeploy } from "../deploy";
import { EXIT, invalid } from "../failure";
import { fail, note, writeJson, writeLines } from "../output";
import { chainName } from "../probe";
import { loadCatalogs, loadInput } from "../session";

const PATH_NAMES = { factory: "LatticeFactory", createx: "CreateX CREATE3" } as const;

export async function runPredict(parsed: Parsed, deps: Deps): Promise<number> {
  const { values } = parsed;
  const json = values.json === true;
  if (parsed.args.length > 0) return fail(deps, json, invalid("predict takes no file. Pass the salt with --project <file>, or --entropy and --scope."));
  const deployer = parseAddress(values.deployer, "--deployer");
  if (!deployer.ok) return fail(deps, json, deployer.error);
  const chainId = parseChainId(values.chain?.[0]);
  if (!chainId.ok) return fail(deps, json, chainId.error);
  const set = await loadCatalogs(values, deps);
  if (!set.ok) return fail(deps, json, set.error);

  let catalog = set.value.fallback.catalog;
  let project: Project | undefined;
  if (values.project !== undefined) {
    const input = await loadInput("predict", [values.project], values, deps, set.value);
    if (!input.ok) return fail(deps, json, input.error);
    if (input.value.project === undefined) {
      return fail(deps, json, invalid(`--project takes a .lattice.json project file; ${values.project} is a recipe.`));
    }
    project = input.value.project;
    catalog = input.value.loaded.catalog;
  }
  const settings = resolveDeploy(values, project?.deploy, deps.random);
  if (!settings.ok) return fail(deps, json, settings.error);
  const fresh = freshEntropyNote(settings.value);
  if (fresh !== null) note(deps, fresh);
  const prediction = predictDiamond(catalog, deployer.value, chainId.value, settings.value);
  if (!prediction.ok) return fail(deps, json, prediction.error);
  const p = prediction.value;
  const name = chainName(p.chainId);

  if (json) {
    writeJson(deps, { address: p.address, chainId: p.chainId, chain: name, path: p.path, scope: p.scope, entropy: p.entropy, entropySource: settings.value.source, from: p.from, salt: p.salt, catalog: catalog.lattice.tag });
  } else {
    writeLines(deps, [
      p.address,
      `Diamond address on ${name} (${p.chainId}) through ${PATH_NAMES[p.path]}, deployed by ${p.from}.`,
      `Salt ${p.salt} · scope ${p.scope} · entropy ${p.entropy}${settings.value.source === "fresh" ? " (new)" : ""}`,
    ]);
  }
  return EXIT.ok;
}
