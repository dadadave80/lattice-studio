/** Joins class names, skipping falsy parts: `cx(styles.button, primary && styles.primary)`. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
