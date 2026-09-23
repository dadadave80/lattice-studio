import { describe, expect, test } from "bun:test";
import { codeAtFor, type ChainState } from "./chain";
import type { Json } from "./json";
import type { LayoutMetrics } from "./layout";
import { PROBLEM_CODES, type ParamsOf, type ProblemCode, type ProblemParams } from "./problems";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type AllJson<T> = { [C in keyof T]: T[C] extends Record<string, Json> ? true : false }[keyof T];

/** Checked by `bun run typecheck`. */
export type ParamsAssertions = [
  // One params type per code, and every one of them fits `Problem.params` at runtime.
  Assert<Equals<keyof ProblemParams, ProblemCode>>,
  Assert<Equals<AllJson<ProblemParams>, true>>,
  Assert<Equals<ParamsOf<"SEL-01">, ProblemParams["SEL-01"]>>,
  // Chain-bearing codes name the chain.
  Assert<Equals<ProblemParams["NET-03"]["chain"], string>>,
  Assert<Equals<ProblemParams["NET-06"]["gas"], string>>,
];

/**
 * `layoutSizes` as `@lattice-studio/tokens` (T1, `packages/tokens/dist/tokens.ts`) declares it. Core can't import
 * the tokens package (spec L102), so this copy proves the shape fits: the app passes the real object.
 */
interface TokensLayoutSizes {
  readonly grid: number;
  readonly snap: number;
  readonly dragThreshold: number;
  readonly nudgeSmall: number;
  readonly nudgeLarge: number;
  readonly cardWidth: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  readonly footerHeight: number;
  readonly collapsedRows: number;
  readonly expandThreshold: number;
  readonly compactZoom: number;
  readonly noteWidth: number;
  readonly traceLabelZoom: number;
  readonly edgeZone: number;
}
const layoutSizes: TokensLayoutSizes = {
  grid: 8, snap: 8, dragThreshold: 4, nudgeSmall: 8, nudgeLarge: 32, cardWidth: 232, headerHeight: 48, rowHeight: 20,
  footerHeight: 28, collapsedRows: 6, expandThreshold: 9, compactZoom: 0.4, noteWidth: 200, traceLabelZoom: 0.75, edgeZone: 48,
};

describe("contract helpers", () => {
  test("the tokens' layoutSizes satisfies LayoutMetrics as it is", () => {
    const metrics: LayoutMetrics = layoutSizes;
    expect(metrics.cardWidth).toBe(232);
  });

  test("every problem code has a params entry", () => {
    const covered: Record<ProblemCode, true> = Object.fromEntries(PROBLEM_CODES.map((code) => [code, true])) as Record<ProblemCode, true>;
    expect(Object.keys(covered).length).toBe(32);
  });

  test("codeAtFor finds lowercase keys from any casing, and says when Studio didn't ask", () => {
    const chain: Pick<ChainState, "codeAt"> = {
      codeAt: { "0x5fbdb2315678afecb367f032d93f642f64180aa3": "0x", "0x71c7656ec7ab88b098defb751b7401b5f6d8976f": "0x6080" },
    };
    expect(codeAtFor(chain, "0x5FbDB2315678afecb367f032d93F642f64180aa3")).toBe("0x");
    expect(codeAtFor(chain, "0x71C7656EC7ab88b098defB751B7401B5f6d8976F")).toBe("0x6080");
    expect(codeAtFor(chain, "0x0000000000000000000000000000000000000001")).toBeUndefined();
    expect(codeAtFor({ codeAt: {} }, "constructor")).toBeUndefined();
  });
});
