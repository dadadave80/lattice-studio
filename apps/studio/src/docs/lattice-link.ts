/**
 * GitHub links into the pinned Lattice checkout (spec L905, contracts §3.1 `Catalog.lattice.commit`).
 * A doc page never hardcodes a commit: it reads the live catalog's and builds the link at render time, so
 * the link always points at the pin the loaded catalog was generated from.
 */

const REPO = "https://github.com/dadadave80/lattice";

/**
 * `latticeUrl("f4a32c8…", "src/LatticeFactory.sol", "103-107")` → the file at the pin, with a line-range
 * fragment when `lines` is given ("103-107" → "#L103-L107"; a single line "44" → "#L44").
 */
export function latticeUrl(commit: string, path: string, lines?: string): string {
  const base = `${REPO}/blob/${commit}/${path}`;
  if (!lines) return base;
  const [start, end] = lines.split("-");
  if (!start) return base;
  return end ? `${base}#L${start}-L${end}` : `${base}#L${start}`;
}

/** The `lattice:<path>[#<lines>]` reference a doc's markdown uses in place of a full URL. */
export function parseLatticeRef(ref: string): { path: string; lines?: string } {
  const rest = ref.slice("lattice:".length);
  const at = rest.indexOf("#");
  if (at === -1) return { path: rest };
  return { path: rest.slice(0, at), lines: rest.slice(at + 1) };
}
