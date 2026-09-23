/**
 * Filename stem for a project's exports: "GovernedVault" -> "governed-vault" (spec L496,
 * "Saved to governed-vault.lattice.json"). A lowercase-or-digit to uppercase run splits first (so PascalCase
 * and camelCase project names read as words), then everything lowercases and non-alphanumeric runs become one
 * hyphen, leading and trailing hyphens trimmed. Empty or entirely punctuation names (including path
 * separators, so a name can never smuggle a directory component into a download) fall back to "untitled".
 */
export function slug(name: string | undefined): string {
  const cleaned = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "untitled" : cleaned;
}
