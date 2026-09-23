/**
 * Text that is safe inside a generated `//` comment (spec L859). A line terminator would end the comment and
 * put the rest of the text in code, a star-slash would end a block comment, and bidi controls reorder what a
 * reviewer sees (Trojan Source). So the result is printable ASCII on one line: tabs and line breaks become
 * spaces, every other control character, DEL and non-ASCII character is written as `\uXXXX` text (`\u{1F600}`
 * above the BMP), runs of spaces collapse, and a star-slash is broken apart.
 */

function visible(cp: number): string {
  if (cp >= 0x20 && cp < 0x7f) return String.fromCodePoint(cp);
  if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, "0")}`;
  return `\\u{${cp.toString(16)}}`;
}

/** `text` as one line of printable ASCII that can't end a comment. */
export function commentText(text: string): string {
  let out = "";
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0xfffd;
    out += cp === 0x09 || cp === 0x0a || cp === 0x0d ? " " : visible(cp);
  }
  let safe = out.replace(/ {2,}/g, " ").trim();
  while (safe.includes("*/")) safe = safe.replaceAll("*/", "* /");
  return safe;
}
