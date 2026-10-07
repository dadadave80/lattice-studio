/** Where an identifier may wrap: after ".", "/", "," and "_", and after a call's "(" (not prose's " ("). */
const BREAK_AFTER = /(?<=[./,_]|\S\()/;

/** A bare hex value (an address, a hash, a selector): it has no word boundaries, so it may break anywhere. */
const HEX = /^0x[0-9a-fA-F]+$/;

/**
 * An identifier cut into the pieces it may wrap between: after each ".", "/", "(", "," and "_".
 * `lattice.storage.GovernedVault` → `lattice.` `storage.` `GovernedVault`. Hex stays whole.
 */
export function splitIdentifier(text: string): string[] {
  if (isHexValue(text)) return [text];
  return text.split(BREAK_AFTER).filter((part) => part !== "");
}

/** Whether `text` is one hex value (`0x…`), the only thing allowed to break mid-token. */
export function isHexValue(text: string): boolean {
  return HEX.test(text);
}
