import type { ProblemCode, ProblemParams } from "@lattice-studio/core";

/** The four grouped sections the index and the helpers split the work by (brief "Build"). */
export type DocFamily = "Selectors and seams" | "Diamond core, dependencies and storage" | "Init, authority and links" | "Chain readiness";

/**
 * One problem code's doc page (spec L905). `meaning`, `why` and each `fixes` item are markdown-lite text
 * (`markdown.tsx`): inline `` `code` `` spans and `[text](url)` links, where `url` is either an ordinary
 * address or `lattice:<path>[#<lines>]` (resolved at the pinned commit). `exampleParams` feeds
 * `renderProblem` so the example is never a copy of the message text (contracts, K2 notes).
 */
export type ProblemDocEntry<C extends ProblemCode = ProblemCode> = {
  code: C;
  family: DocFamily;
  /** Short heading, distinct from the rendered message ("Selector needs an owner", not the message itself). */
  title: string;
  /** What the problem means, one or two short paragraphs. */
  meaning: string;
  /** Why Lattice or Studio enforces this, citing the rule and its source. */
  why: string;
  /** How to fix it, one bullet per fix the note offers (contracts §3.3). */
  fixes: readonly string[];
  exampleParams: ProblemParams[C];
  /** One sentence introducing the example, before the rendered message. */
  exampleNote?: string;
};
