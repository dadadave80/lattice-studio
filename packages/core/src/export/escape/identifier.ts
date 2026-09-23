/**
 * Identifiers and file names for generated code (spec L859): only `[A-Za-z0-9_]`, never starting with a digit,
 * never empty and never a Solidity keyword, so a name can't change the code around it.
 */

/** Solidity keywords, reserved words, elementary type names and literals an identifier can't be. */
const RESERVED = new Set(
  (
    "abstract after alias at anonymous apply as assembly auto bool break byte bytes calldata case catch constant " +
    "constructor continue contract copyof default define delete do else emit enum error event external fallback " +
    "false final for function global hex if immutable implements import in indexed inline interface internal is " +
    "layout let library macro mapping match memory modifier mutable new null of override partial payable pragma " +
    "private promise public pure receive reference relocatable return returns revert sealed sizeof static storage " +
    "string struct super supports switch this throw transient true try type typedef typeof unchecked unicode using " +
    "var view virtual while address fixed ufixed int uint wei gwei ether seconds minutes hours days weeks years " +
    "szabo finney _"
  ).split(" "),
);

const ELEMENTARY = /^(?:u?int(?:\d+)?|bytes\d+|u?fixed(?:\d+x\d+)?)$/;

/** True when `name` can be used as a Solidity identifier as it is. */
export function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name) && !ELEMENTARY.test(name);
}

/**
 * `text` reduced to `[A-Za-z0-9_]`: other characters are dropped, a leading digit gets a `_` in front, and a
 * keyword or an empty result gets `fallback` (itself sanitized) or a trailing `_`.
 */
export function sanitizeIdentifier(text: string, fallback = "Unnamed"): string {
  let name = text.replace(/[^A-Za-z0-9_]/g, "");
  if (name === "") name = fallback.replace(/[^A-Za-z0-9_]/g, "") || "Unnamed";
  if (/^[0-9]/.test(name)) name = `_${name}`;
  while (!isSafeIdentifier(name)) name = `${name}_`;
  return name;
}

/**
 * `text` as a PascalCase identifier: words split on anything outside `[A-Za-z0-9]`, each word's first letter
 * upper-cased, the rest kept. "GovernedVault (shared)" becomes "GovernedVaultShared".
 */
export function pascalIdentifier(text: string, fallback = "Unnamed"): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter((word) => word !== "");
  const joined = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return sanitizeIdentifier(joined, fallback);
}
