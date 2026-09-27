// Pure logic behind `bun scripts/ci/append-catalog-hash-to-release.ts` (§16 audit #7, spec L855 "the catalog
// hash is published with the release"): finds the hash of the catalog a release ships, and the line that goes
// into that release's notes.
export type CatalogManifest = {
  readonly default: string;
  readonly catalogs: readonly { readonly id: string; readonly hash: string }[];
};

/** The default catalog's committed hash, or null if the manifest has no entry for its own `default` id. */
export function defaultCatalogHash(manifest: CatalogManifest): string | null {
  return manifest.catalogs.find((c) => c.id === manifest.default)?.hash ?? null;
}

/** The release-notes line for a catalog id and hash (spec L855). */
export function catalogNotesLine(id: string, hash: string): string {
  return `Catalog: \`${id}\` (hash \`${hash}\`).`;
}

/** `body` with the catalog line appended once, as its own paragraph; a body that already carries this exact
 * line (a re-run editing the same release) is left unchanged. */
export function withCatalogNotesLine(body: string, id: string, hash: string): string {
  const line = catalogNotesLine(id, hash);
  if (body.includes(line)) return body;
  const trimmed = body.replace(/\s+$/, "");
  return trimmed.length > 0 ? `${trimmed}\n\n${line}\n` : `${line}\n`;
}
