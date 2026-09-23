/**
 * The command line (spec L921), parsed with `node:util`'s `parseArgs`. Every option is declared once; each
 * command lists the ones it takes, so `check --safe 0x…` is refused instead of ignored.
 */
import { parseArgs } from "node:util";
import { err, ok, type Result } from "@lattice-studio/core";
import { errorMessage } from "./failure";

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  json: { type: "boolean" },
  catalog: { type: "string" },
  deployer: { type: "string" },
  chain: { type: "string", multiple: true },
  path: { type: "string" },
  project: { type: "string" },
  entropy: { type: "string" },
  scope: { type: "string" },
  safe: { type: "string" },
  rpc: { type: "string" },
  confirm: { type: "string", multiple: true },
  out: { type: "string" },
  lattice: { type: "string" },
} as const;

export type OptionName = keyof typeof OPTIONS;

export type Values = {
  help?: boolean;
  version?: boolean;
  json?: boolean;
  catalog?: string;
  deployer?: string;
  chain?: string[];
  path?: string;
  project?: string;
  entropy?: string;
  scope?: string;
  safe?: string;
  rpc?: string;
  confirm?: string[];
  out?: string;
  lattice?: string;
};

export type CommandName = "check" | "plan" | "predict" | "export foundry" | "export brief" | "export recipe" | "export safe" | "verify-catalog";

export type Parsed = {
  /** Undefined for a bare `--help` or `--version`. */
  command?: CommandName;
  /** Positional arguments after the command (and the export kind). */
  args: string[];
  values: Values;
};

const COMMON: readonly OptionName[] = ["help", "json", "catalog"];
const SALT: readonly OptionName[] = ["path", "project", "entropy", "scope"];

/** The options each command takes. */
export const COMMAND_OPTIONS: Record<CommandName, readonly OptionName[]> = {
  check: [...COMMON, ...SALT, "deployer", "chain", "rpc", "confirm"],
  plan: [...COMMON, ...SALT, "deployer", "chain", "rpc", "confirm"],
  predict: [...COMMON, ...SALT, "deployer", "chain"],
  "export foundry": [...COMMON, ...SALT, "chain", "confirm", "out"],
  "export brief": [...COMMON, "project", "confirm", "out"],
  "export recipe": [...COMMON, "project", "out"],
  "export safe": [...COMMON, ...SALT, "safe", "chain", "confirm", "out"],
  "verify-catalog": [...COMMON, "lattice"],
};

const EXPORT_KINDS = ["foundry", "brief", "recipe", "safe"] as const;

export function parseCommandLine(argv: readonly string[]): Result<Parsed, string> {
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    return err(errorMessage(error).replace(/\. To specify a positional argument.*$/s, "."));
  }
  const values = parsed.values as Values;
  const [first, ...rest] = parsed.positionals;
  if (first === undefined) {
    if (values.help === true || values.version === true) return ok({ args: [], values });
    return err("Name a command: check, plan, predict, export or verify-catalog.");
  }
  let command: CommandName;
  let args = rest;
  if (first === "export") {
    const [kind, ...more] = rest;
    if (kind === undefined && values.help === true) return ok({ command: "export foundry", args: [], values });
    if (kind === undefined || !(EXPORT_KINDS as readonly string[]).includes(kind)) {
      return err(`export takes foundry, brief, recipe or safe${kind === undefined ? "" : `, not ${kind}`}.`);
    }
    command = `export ${kind}` as CommandName;
    args = more;
  } else if (first === "check" || first === "plan" || first === "predict" || first === "verify-catalog") {
    command = first;
  } else if (first === "help") {
    return ok({ args: [], values: { ...values, help: true } });
  } else {
    return err(`${first} isn't a command. Use check, plan, predict, export or verify-catalog.`);
  }
  const allowed = new Set<string>(COMMAND_OPTIONS[command]);
  for (const name of Object.keys(values)) {
    if (name === "version") continue;
    if (!allowed.has(name)) return err(`${command} doesn't take --${name}.`);
  }
  if ((values.chain?.length ?? 0) > 1 && command !== "export foundry") return err(`${command} takes one --chain.`);
  if ((values.confirm?.length ?? 0) > 0 && values.confirm?.some((c) => !c.includes("="))) {
    return err("--confirm takes <path>=<address>, for example --confirm 'steps[0].safe=0x…'.");
  }
  return ok({ command, args, values });
}
