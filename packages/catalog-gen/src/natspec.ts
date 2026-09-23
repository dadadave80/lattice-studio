/**
 * NatSpec for facet shards (contracts §3.1 `FacetDetail.natspec`): the contract's notice and dev note, and each
 * routed selector's notice, dev note and parameter docs, keyed by selector. Read from solc's metadata
 * (`userdoc`/`devdoc`), where `@inheritdoc` is already resolved.
 */
import type { FacetDetail } from "@lattice-studio/core";
import type { FacetSelector, SolcMetadata } from "./artifacts";

export type FacetNatspec = FacetDetail["natspec"];
type FunctionDoc = FacetNatspec["functions"][`0x${string}`];

/**
 * Solc keeps the indentation of continuation lines ("the         diamond"). This collapses every run of
 * whitespace to one space and trims; empty text is absent.
 */
export function cleanDoc(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean === "" ? undefined : clean;
}

/**
 * The first sentence of a notice: up to the first ".", "!" or "?" followed by whitespace and a capital letter,
 * a backtick or a brace, or by the end. "Stateless Diamond facet for the ERC-20 token standard."
 */
export function firstSentence(text: string | undefined): string | undefined {
  const clean = cleanDoc(text);
  if (clean === undefined) return undefined;
  const m = /^(.*?[.!?])(?:\s+(?=[A-Z`{])|$)/.exec(clean);
  return m?.[1] ?? clean;
}

/** A facet's one-line summary from its contract notice, for when the overlay has none (CG5 owns the overlay). */
export function natspecSummary(metadata: Pick<SolcMetadata, "output">): string | undefined {
  return firstSentence(metadata.output.userdoc.notice);
}

/**
 * The shard's NatSpec for a facet's routed selectors, in their order. Functions with no docs at all are left out;
 * `params` appears only when the dev docs name some.
 */
export function facetNatspec(metadata: Pick<SolcMetadata, "output">, selectors: FacetSelector[]): FacetNatspec {
  const { userdoc, devdoc } = metadata.output;
  const functions: FacetNatspec["functions"] = {};
  for (const { hex, signature } of selectors) {
    const doc: FunctionDoc = {};
    const notice = cleanDoc(userdoc.methods?.[signature]?.notice);
    const dev = cleanDoc(devdoc.methods?.[signature]?.details);
    if (notice !== undefined) doc.notice = notice;
    if (dev !== undefined) doc.dev = dev;
    const params: Record<string, string> = {};
    for (const [name, text] of Object.entries(devdoc.methods?.[signature]?.params ?? {})) {
      const clean = cleanDoc(text);
      if (clean !== undefined) params[name] = clean;
    }
    if (Object.keys(params).length > 0) doc.params = params;
    if (Object.keys(doc).length > 0) functions[hex] = doc;
  }
  const out: FacetNatspec = { functions };
  const notice = cleanDoc(userdoc.notice);
  const dev = cleanDoc(devdoc.details);
  if (notice !== undefined) out.notice = notice;
  if (dev !== undefined) out.dev = dev;
  return out;
}
