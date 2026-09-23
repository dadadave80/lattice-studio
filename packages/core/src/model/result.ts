/**
 * Core never throws for expected failures; it returns a `Result` (contracts §3.1).
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** A successful `Result`. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** A failed `Result`. */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
