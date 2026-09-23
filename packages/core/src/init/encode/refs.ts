/**
 * References (spec L285, R7): "This diamond" is `{"$ref":"self"}` and "Deploying account" is
 * `{"$ref":"deployer"}`. Recipes keep them symbolic; each transaction, script or batch resolves them for its
 * own chain, path, signer and salt.
 */
import type { CollectRefsFn, ResolveRefsFn } from "../../model/api";
import type { RefName } from "../../model/recipe";
import { checkRefs, resolveArgsAt, walkRefs } from "./resolve";

/** The references the recipe's init uses, each once, in first-use order (steps in call order, fields as written). */
export const collectRefs: CollectRefsFn = (recipe) => {
  const found: RefName[] = [];
  const visit = (name: RefName) => {
    if (!found.includes(name)) found.push(name);
  };
  const init = recipe.init;
  if (init.kind === "bundle") walkRefs(init.args, visit);
  if (init.kind === "steps") for (const step of init.steps) walkRefs(step.args, visit);
  return found;
};

/**
 * Replaces every reference in `args` with its address (EIP-55). Fails, naming the argument path, when a
 * reference is used whose address `refs` doesn't give; unused references may be absent.
 */
export const resolveRefs: ResolveRefsFn = (args, refs) => {
  const checked = checkRefs(refs);
  if (!checked.ok) return checked;
  return resolveArgsAt(args, refs, "");
};
