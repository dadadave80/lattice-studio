import type { RenderProblemFn } from "../model/api";
import type { Hex4 } from "../model/hex";
import type { Json } from "../model/json";
import type { ProblemCode, ProblemParams } from "../model/problems";
import { formatAddress, formatSelector } from "../format/format";
import { formatMagnitude, functionName, joinAnd, joinOr, lowerFirst, truncateHex10 } from "../format/text";

function sel(hex: Hex4, signature: string, style: "full" | "dense" = "full"): string {
  return formatSelector({ hex, signature }, style);
}

/** Strips a trailing period so a clause can be re-joined and re-punctuated once. */
function clause(text: string): string {
  return text.trim().replace(/\.$/, "");
}

function jsonText(value: Json): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return JSON.stringify(value);
}

// ── SEL, SEM ───────────────────────────────────────────────────────────────────────────────────────

function renderSel01(p: ProblemParams["SEL-01"]): string {
  return `${sel(p.selector, p.signature)} is exported by ${joinAnd(p.contenders)}. Choose one owner.`;
}

function renderSel02(p: ProblemParams["SEL-02"]): string {
  return `${p.facet} gives ${p.count} ${p.count === 1 ? "selector" : "selectors"} to ${joinAnd(p.to)}.`;
}

function sel03Subject(count: number): string {
  if (count === 1) return "its only selector";
  if (count === 2) return "both its selectors";
  return "all its selectors";
}

function renderSel03(p: ProblemParams["SEL-03"]): string {
  const subject = sel03Subject(p.count);
  const singular = p.count === 1;
  const be = singular ? "is" : "are";
  const clause =
    p.why === "seams"
      ? `${be} ${singular ? "a seam" : "seams"} that ${joinAnd(p.servedBy)} ${p.servedBy.length === 1 ? "serves" : "serve"}`
      : p.why === "owned"
        ? `${be} owned by ${joinAnd(p.servedBy)}`
        : p.why === "excluded"
          ? `${be} excluded`
          : singular
            ? "is split between a seam, another owner or an exclusion"
            : "are split between seams, other owners and exclusions";
  return `${p.facet} cuts nothing: ${subject} ${clause}. Remove it.`;
}

function renderSel04(p: ProblemParams["SEL-04"]): string {
  return `\`${p.signature}\` is never cut into a diamond.`;
}

function renderSel05(p: ProblemParams["SEL-05"]): string {
  const phrase = p.signature ? `\`${functionName(p.signature)}\` ${p.selector}` : p.selector;
  return p.reason === "not-placed"
    ? `${p.facet} isn't on the sheet, so it can't own ${phrase}.`
    : `${p.facet} doesn't export ${phrase}, so it can't own it.`;
}

function renderSem01(p: ProblemParams["SEM-01"]): string {
  // Signature alone, no hex (spec L317): unlike SEL-01, the seam's message never repeats the selector's hex.
  const subject = `\`${p.signature}\``;
  if (p.nonePlaced || !p.owner) {
    return `${subject} must be served by a version that ${p.reason}: place ${joinOr(p.allowed)}.`;
  }
  return `${subject} must be served by a version that ${p.reason} (${joinOr(p.allowed)}), not ${p.owner}.`;
}

// ── CORE ───────────────────────────────────────────────────────────────────────────────────────────

function renderCore01(p: ProblemParams["CORE-01"]): string {
  const state = p.excluded ? "excluded" : "missing";
  return `The loupe is incomplete: \`${p.signature}\` is ${state}. Every Lattice diamond needs all four.`;
}

function renderCore02(): string {
  return "Nothing can change this diamond after deploy.";
}

function renderCore03(p: ProblemParams["CORE-03"]): string {
  return `One upgrade mechanism per diamond: ${clause(p.reason)}.`;
}

function renderCore04(): string {
  return "Plain ETH sent to this diamond will revert.";
}

function renderCore05(): string {
  return "`supportsInterface()` won't exist; wallets and explorers can't detect interfaces.";
}

// ── DEP, STO ───────────────────────────────────────────────────────────────────────────────────────

function renderDep01(p: ProblemParams["DEP-01"]): string {
  return `${p.facet} requires ${joinOr(p.anyOf)}: ${clause(p.reason)}.`;
}

function renderDep02(p: ProblemParams["DEP-02"]): string {
  if (p.kind === "companion") {
    return `${p.facet} usually ships with ${joinOr(p.anyOf)}, so ${clause(p.reason)}.`;
  }
  // Namespace, with a reason: the check already wrote the whole sentence (contracts §3.1; spec L323's
  // "Roles are written at init, but without AccessControl nobody can manage them later."), so it's used
  // verbatim. Only without one does C10 word it generically from `namespace` and `anyOf`.
  if (p.reason) return p.reason;
  return `\`${p.namespace}\` is written at init, but without ${joinOr(p.anyOf)} nobody can manage it later.`;
}

function renderDep03(p: ProblemParams["DEP-03"]): string {
  const kind = p.family === "access" ? "access models" : "account models";
  return `${joinAnd(p.facets)} are different ${kind}; one diamond holds one.`;
}

function renderSto01(p: ProblemParams["STO-01"]): string {
  return `\`${p.id}\` is claimed by ${joinAnd(p.facets)}.`;
}

function renderSto02(p: ProblemParams["STO-02"]): string {
  return `${p.facet} shares \`${p.namespace}\` with ${p.owner}.`;
}

// ── INIT ───────────────────────────────────────────────────────────────────────────────────────────

function renderInit01(p: ProblemParams["INIT-01"]): string {
  if (p.missing || p.value === undefined) return `${clause(p.detail)}.`;
  return `${p.label} is ${jsonText(p.value)}; ${clause(p.detail)}.`;
}

function renderInit02(p: ProblemParams["INIT-02"]): string {
  return `${p.module} initializes before ${p.after}; it must come after.`;
}

function renderInit03(p: ProblemParams["INIT-03"]): string {
  const subject = joinAnd(p.specs);
  if (p.case === "conflict") {
    return p.detail ? `${subject} both ${clause(p.detail)}.` : `${subject} both set up ${p.module}, in ways that conflict.`;
  }
  if (p.case === "roles") {
    return `${subject} both set up ${p.module}, granting its roles to different admins.`;
  }
  return `${subject} both set up ${p.module}, identically.`;
}

function renderInit04(p: ProblemParams["INIT-04"]): string {
  if (p.facet) {
    return p.consequence ? `${p.facet} has no init step, so ${clause(p.consequence)}.` : `${p.facet} has no init step, so ${p.module} is never initialized.`;
  }
  return p.sameCallWith
    ? `${p.module} has no init step; it initializes in the same call as ${p.sameCallWith}, so it needs one too.`
    : `${p.module} has no init step, so it is never initialized.`;
}

function unitText(value: Json, unit?: "seconds" | "percent" | "wei"): string {
  const text = jsonText(value);
  if (unit === "seconds") return `${text} s`;
  if (unit === "percent") return `${text}%`;
  if (unit === "wei") return `${text} wei`;
  return text;
}

function renderInit05(p: ProblemParams["INIT-05"]): string {
  const listed = p.examples.slice(0, 2).map((e) => `${lowerFirst(e.label)} (${unitText(e.value, e.unit)})`);
  return `${p.count} ${p.count === 1 ? "field" : "fields"} still ${p.count === 1 ? "uses" : "use"} example values, including ${joinAnd(listed)}.`;
}

// ── AUTH, LINK ─────────────────────────────────────────────────────────────────────────────────────

function renderAuth01(p: ProblemParams["AUTH-01"]): string {
  const roles = joinAnd(p.roles.map((r) => `\`${r}\``));
  const holder = formatAddress(p.holder);
  // A delegated EIP-7702 account can't be an undeployed Safe, so that suggestion only fits the no-code case.
  if (p.delegated) return `${roles} rest with ${holder}, an EIP-7702 delegated account.`;
  return `${roles} rest with ${holder}, a single key. If it's a Safe that isn't deployed yet, deploy it first.`;
}

/** One role-wording table for AUTH-02's subject and LINK-01's role label (spec L333-L334). */
const ROLE_WORDS: Record<string, { label: string; subject: string }> = {
  DEFAULT_ADMIN_ROLE: { label: "The admin role", subject: "The admin" },
  diamondCut: { label: "The upgrade role", subject: "The upgrade holder" },
  scheduleCut: { label: "The upgrade role", subject: "The upgrade holder" },
  owner: { label: "Ownership", subject: "The owner" },
  signer: { label: "The signer role", subject: "The signer" },
};

function roleWords(role: string): { label: string; subject: string } {
  return ROLE_WORDS[role] ?? { label: `The \`${role}\` role`, subject: `The \`${role}\` holder` };
}

function renderAuth02(p: ProblemParams["AUTH-02"]): string {
  const address = formatAddress(p.address);
  const subject = roleWords(p.role).subject;
  if (p.source === "prediction") {
    return `${subject} is ${address}, where this diamond would have been before the salt changed.`;
  }
  if (p.source === "deployment") {
    return `${subject} is ${address}, an address a deployment on ${p.chain ?? "another chain"} recorded.`;
  }
  return `${subject} is ${address}, an address this diamond had or a recorded deployment holds.`;
}

function renderLink01(p: ProblemParams["LINK-01"]): string {
  const address = formatAddress(p.address);
  const source = p.source === "link" ? "a shared link" : p.source === "file" ? "an opened file" : undefined;
  const label = roleWords(p.role).label;
  return source
    ? `${label} goes to ${address}, which came from ${source}.`
    : `${label} goes to ${address}, which came from a link or a file and hasn't been confirmed.`;
}

// ── NET ────────────────────────────────────────────────────────────────────────────────────────────

function renderNet01(p: ProblemParams["NET-01"]): string {
  if (p.case === "missing") return `CreateX isn't deployed on ${p.chain}.`;
  return `The contract at CreateX's address on ${p.chain} isn't CreateX: its codehash differs from ${truncateHex10(p.expected)}.`;
}

function renderNet02(p: ProblemParams["NET-02"]): string {
  if (p.case === "missing") return `Arachnid's deployment proxy isn't on ${p.chain}, so missing contracts can't be deployed at their release addresses.`;
  return `Arachnid's deployment proxy at its address on ${p.chain} isn't the deployer: its codehash differs from ${truncateHex10(p.expected)}.`;
}

function renderNet03(p: ProblemParams["NET-03"]): string {
  const parts: string[] = [...p.core];
  if (p.missing.length > 0) parts.push(`${p.missing.length} of ${p.total} facets and init contracts`);
  return `${joinAnd(parts)} aren't on ${p.chain} yet. Anyone can deploy them at their release addresses.`;
}

function renderNet04(p: ProblemParams["NET-04"]): string {
  return `The code at ${formatAddress(p.address)} isn't Lattice ${p.name} ${p.version}.`;
}

function renderNet05(p: ProblemParams["NET-05"]): string {
  return p.path === "factory"
    ? "This account already deployed a diamond with this salt; deploying would return it and ignore this recipe."
    : `This salt was already used on ${p.chain}; deploying would revert.`;
}

function renderNet06(p: ProblemParams["NET-06"]): string {
  return `This deploy needs about ${formatMagnitude(Number(p.gas))} gas; ${p.chain} allows ${formatMagnitude(Number(p.cap))} per transaction.`;
}

function renderNet07(): string {
  return "Simulating with `eth_call`: fewer details in the preview.";
}

function renderNet08(p: ProblemParams["NET-08"]): string {
  const facet = p.count === 1 ? "facet" : "facets";
  const version = p.count === 1 ? "its pinned version" : "their pinned versions";
  return `${p.count} ${facet} will be cut without the registry's on-chain check: ${p.chain}'s LatticeRegistry doesn't list ${version}.`;
}

// ── dispatch ───────────────────────────────────────────────────────────────────────────────────────

type Renderer = (params: never) => string;

const RENDERERS: Readonly<Record<ProblemCode, Renderer>> = {
  "SEL-01": renderSel01, "SEL-02": renderSel02, "SEL-03": renderSel03, "SEL-04": renderSel04, "SEL-05": renderSel05,
  "SEM-01": renderSem01,
  "CORE-01": renderCore01, "CORE-02": renderCore02, "CORE-03": renderCore03, "CORE-04": renderCore04, "CORE-05": renderCore05,
  "DEP-01": renderDep01, "DEP-02": renderDep02, "DEP-03": renderDep03,
  "STO-01": renderSto01, "STO-02": renderSto02,
  "INIT-01": renderInit01, "INIT-02": renderInit02, "INIT-03": renderInit03, "INIT-04": renderInit04, "INIT-05": renderInit05,
  "AUTH-01": renderAuth01, "AUTH-02": renderAuth02,
  "LINK-01": renderLink01,
  "NET-01": renderNet01, "NET-02": renderNet02, "NET-03": renderNet03, "NET-04": renderNet04, "NET-05": renderNet05,
  "NET-06": renderNet06, "NET-07": renderNet07, "NET-08": renderNet08,
} as const;

/** The checks table's message template, word for word (spec L309-L342), from `code` and its typed `params`. */
export const renderProblem: RenderProblemFn = (code, params) => RENDERERS[code](params as never);
