/**
 * `check <file>` and `plan <file>` (spec L921). Both analyze the recipe exactly as the app does (spec L296: the
 * same output byte for byte in the browser, the CLI and CI) and exit 1 when it has blockers. `--deployer` with
 * `--chain` adds the deploy context (references resolve, NET checks run) and read-only readiness probes.
 */
import { basename } from "node:path";
import { buildPlan, type ChainState, err, ok, type Result } from "@lattice-studio/core";
import type { Parsed } from "../args";
import type { Deps } from "../deps";
import { freshEntropyNote, parseAddress, parseChainId, predictDiamond, type Prediction, resolveDeploy } from "../deploy";
import { EXIT, type Failure, invalid } from "../failure";
import type { Input } from "../input";
import { blockerCount, checkLines, fail, note, planLines, writeJson, writeLines } from "../output";
import { chainName, defaultRpc, httpTransport, probeChain } from "../probe";
import { analyzeInput, loadCatalogs, loadInput, saltProject } from "../session";

/** The deploy context and probes for `--deployer` and `--chain`; nothing when neither is given. */
async function deployContext(
  command: string,
  parsed: Parsed,
  input: Input,
  deps: Deps,
  project: Awaited<ReturnType<typeof saltProject>>,
): Promise<Result<{ prediction?: Prediction; chain?: ChainState }, Failure>> {
  const { values } = parsed;
  const chainFlag = values.chain?.[0];
  const saltFlags = values.entropy !== undefined || values.scope !== undefined || values.path !== undefined || values.rpc !== undefined;
  if (values.deployer === undefined && chainFlag === undefined) {
    if (saltFlags || (values.project !== undefined && parsed.args.length > 0)) {
      return err(invalid(`${command} uses --path, --entropy, --scope, --project and --rpc only with --deployer and --chain.`));
    }
    return ok({});
  }
  if (values.deployer === undefined) {
    return err(invalid("--chain needs --deployer <address>: readiness depends on the address this account would deploy the diamond at."));
  }
  if (chainFlag === undefined) return err(invalid("--deployer needs --chain <id>: the diamond's address depends on the chain."));
  const deployer = parseAddress(values.deployer, "--deployer");
  if (!deployer.ok) return deployer;
  const chainId = parseChainId(chainFlag);
  if (!chainId.ok) return chainId;
  if (!project.ok) return project;
  const settings = resolveDeploy(values, project.value?.deploy, deps.random);
  if (!settings.ok) return settings;
  const fresh = freshEntropyNote(settings.value);
  if (fresh !== null) note(deps, fresh);
  const catalog = input.loaded.catalog;
  const prediction = predictDiamond(catalog, deployer.value, chainId.value, settings.value);
  if (!prediction.ok) return prediction;

  const url = values.rpc ?? deps.env["LATTICE_STUDIO_RPC_URL"] ?? defaultRpc(chainId.value);
  if (url === undefined) {
    return err(invalid(`${chainName(chainId.value)} has no public RPC Studio knows. Pass --rpc <url> or set LATTICE_STUDIO_RPC_URL.`));
  }
  const probed = await probeChain({
    chainId: chainId.value,
    transport: (deps.transport ?? httpTransport)(url),
    catalog,
    recipe: input.recipe,
    path: settings.value.path,
    predicted: prediction.value.address,
    deployer: deployer.value,
    now: deps.now,
  });
  if (!probed.ok) return err(invalid(probed.error));
  if (probed.value.note !== undefined) note(deps, probed.value.note);
  return ok({ prediction: prediction.value, chain: probed.value.state });
}

export async function runCheck(command: "check" | "plan", parsed: Parsed, deps: Deps): Promise<number> {
  const json = parsed.values.json === true;
  const set = await loadCatalogs(parsed.values, deps);
  if (!set.ok) return fail(deps, json, set.error);
  const input = await loadInput(command, parsed.args, parsed.values, deps, set.value);
  if (!input.ok) return fail(deps, json, input.error);
  const project = await saltProject(parsed.values, input.value, deps, set.value);
  const deploy = await deployContext(command, parsed, input.value, deps, project);
  if (!deploy.ok) return fail(deps, json, deploy.error);
  const analyzed = analyzeInput(input.value, parsed.values, deploy.value);
  if (!analyzed.ok) return fail(deps, json, analyzed.error);
  const { analysis } = analyzed.value;
  const { recipe, loaded } = input.value;
  const fallbackName = basename(input.value.file).replace(/(\.lattice)?\.json$/i, "");

  if (command === "check") {
    if (json) writeJson(deps, analysis);
    else writeLines(deps, checkLines(recipe, loaded.catalog, analysis, fallbackName));
  } else if (json) {
    const { omitted } = buildPlan(recipe, loaded.catalog, analysis.routing);
    const { recipeHash, plan, init, stats, problems } = analysis;
    writeJson(deps, { recipeHash, plan, omitted, init, stats, problems });
  } else {
    writeLines(deps, planLines(recipe, loaded.catalog, analysis, fallbackName));
  }
  return blockerCount(analysis) > 0 ? EXIT.blockers : EXIT.ok;
}
