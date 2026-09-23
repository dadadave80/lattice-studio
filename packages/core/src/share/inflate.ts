import { Inflate } from "fflate";
import { err, ok, type Result } from "../model/result";

/**
 * Compressed bytes per inflate step. Deflate expands at most about 1032:1, so one step yields at most
 * ~264 KB and the cap is checked before a bomb can grow much past it.
 */
const INFLATE_CHUNK = 256;

/**
 * Inflates raw deflate, refusing (never truncating) output past `cap` bytes. `short`: the input ends before
 * the final block; `damaged`: it isn't deflate data.
 */
export function inflateCapped(data: Uint8Array, cap: number): Result<Uint8Array, "over" | "short" | "damaged"> {
  if (data.length === 0) return err("short");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total <= cap) chunks.push(chunk);
  });
  try {
    for (let at = 0; at < data.length; at += INFLATE_CHUNK) {
      inflater.push(data.subarray(at, at + INFLATE_CHUNK), at + INFLATE_CHUNK >= data.length);
      if (total > cap) return err("over");
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 0) return err("short");
    return err("damaged");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return ok(out);
}

