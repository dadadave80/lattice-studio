import { deflateSync, strFromU8, strToU8 } from "fflate";
import { canonicalJson } from "../canonical/json";
import { recipeHash } from "../canonical/hash";
import { parseRecipe } from "../canonical/parse";
import type { DecodeShareLinkFn, EncodeShareLinkFn } from "../model/api";
import type { ParseIssue } from "../model/io";
import { err, ok, type Result } from "../model/result";
import { decodeBase64url, encodeBase64url } from "./base64url";
import { inflateCapped } from "./inflate";
import { unconfirmedPaths } from "./paths";

/** The share format this Studio writes and reads: the `1` in `#s=1.` (spec L291). */
export const SHARE_VERSION = 1;

/** Studio warns above this many characters, Discord's message limit (spec L291, L502). */
export const SHARE_WARN_LENGTH = 2000;

/** The most a link may decompress to. A recipe is a few kilobytes; anything past this is refused, never cut. */
export const SHARE_MAX_BYTES = 256 * 1024;

/**
 * `#s=1.<base64url(deflate-raw(recipe))>`: the canonical recipe without `$schema`, deflated at level 9
 * (spec L291). Pass the recipe as the project stores it (normalized): decoding normalizes, so the round trip
 * is the identity only for normalized input. `length` counts the fragment, `#s=1.` included; the app adds
 * its own origin when it reports the whole link's length.
 */
export const encodeShareLink: EncodeShareLinkFn = (recipe) => {
  const { $schema: _schema, ...payload } = recipe;
  const bytes = deflateSync(strToU8(canonicalJson(payload)), { level: 9 });
  const fragment = `#s=${SHARE_VERSION}.${encodeBase64url(bytes)}`;
  return { fragment, length: fragment.length, tooLong: fragment.length > SHARE_WARN_LENGTH };
};

function fail(message: string): { ok: false; error: ParseIssue[] } {
  return err([{ path: "", message }]);
}

const CUT_SHORT = "This link is cut short: its recipe ends early. Copy the whole link again.";

/** The payload after `s=1.`, as bytes; every failure says what's wrong with the link. */
function payloadOf(fragment: string): Result<Uint8Array, ParseIssue[]> {
  const text = fragment.trim();
  const hash = text.indexOf("#");
  const body = hash === -1 ? text : text.slice(hash + 1);
  const match = /^s=([^.]*)\.([\s\S]*)$/.exec(body);
  if (match === null) return fail(`This isn't a Studio share link: it should start with #s=${SHARE_VERSION}.`);
  const version = match[1] ?? "";
  const data = match[2] ?? "";
  if (!/^[0-9]+$/.test(version)) return fail(`This link's format version is ‘${version}’; expected ${SHARE_VERSION}.`);
  const needs = Number(version);
  if (needs > SHARE_VERSION) return fail(`This link needs Studio share format v${needs}. This Studio reads v${SHARE_VERSION}.`);
  if (needs < SHARE_VERSION) return fail(`This link's format version is ${needs}; share formats start at v${SHARE_VERSION}.`);
  if (data === "") return fail(`This link has no recipe after #s=${SHARE_VERSION}.`);
  const decoded = decodeBase64url(data);
  if (decoded.ok) return decoded;
  if (decoded.error.kind === "length") return fail(CUT_SHORT);
  const { char, position } = decoded.error;
  return fail(`This link is damaged: ‘${char}’ at character ${position} of its recipe can't appear in a share link.`);
}

/** UTF-8 that survives a decode and re-encode unchanged; malformed bytes would come back as U+FFFD. */
function utf8(bytes: Uint8Array): string | null {
  const text = strFromU8(bytes);
  const again = strToU8(text);
  if (again.length !== bytes.length) return null;
  for (let at = 0; at < bytes.length; at++) if (again[at] !== bytes[at]) return null;
  return text;
}

function decode(fragment: string, catalogs: Parameters<typeof decodeShareLink>[1]): ReturnType<typeof decodeShareLink> {
  const payload = payloadOf(fragment);
  if (!payload.ok) return payload;
  const inflated = inflateCapped(payload.value, SHARE_MAX_BYTES);
  if (!inflated.ok) {
    if (inflated.error === "over") {
      return fail(`This link's recipe is over ${SHARE_MAX_BYTES / 1024} KB once decompressed, far more than any recipe needs, so Studio didn't open it.`);
    }
    if (inflated.error === "short") return fail(CUT_SHORT);
    return fail(`This link is damaged: its recipe doesn't decompress (${inflated.error}).`);
  }
  const text = utf8(inflated.value);
  if (text === null) return fail("This link is damaged: its recipe isn't UTF-8 text.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("This link is damaged: its recipe isn't valid JSON.");
  }
  const parsed = parseRecipe(json, { catalogs, source: "link" });
  if (!parsed.ok) return parsed;
  const { value: recipe, unknownFields, catalog } = parsed.value;
  return ok({ recipe, hash: recipeHash(recipe), unconfirmed: unconfirmedPaths(recipe, catalog), unknownFields, catalog });
}

/**
 * Opens a `#s=1.…` link (a bare fragment, or a whole URL): version check, base64url, inflate capped at
 * 256 KB, JSON, then C1's `parseRecipe` with `source: "link"`. Returns the normalized recipe, its hash, the
 * authority paths holding literal addresses (LINK-01) and the catalog it names (null: opens read-only).
 * Every failure is a `ParseIssue` about the whole link; it never throws.
 */
export const decodeShareLink: DecodeShareLinkFn = (fragment, catalogs) => {
  try {
    return decode(fragment, catalogs);
  } catch (error) {
    const reason = error instanceof RangeError ? "it nests too deeply" : "Studio couldn't read it";
    return fail(`This link's recipe can't be opened: ${reason}.`);
  }
};
