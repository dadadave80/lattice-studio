/**
 * Keeps a fork's RPC URL out of every message the chain tests print. Anvil's fork errors (a bad key, a rate limit,
 * a node without archive state) quote the endpoint, key included, and prool passes anvil's stderr on word for word.
 * The node registers its fork URL; errors, forge output and result-table rows go through `scrub` before anyone
 * sees them.
 */

export const URL_PLACEHOLDER = "<SEPOLIA_RPC_URL>";

/** Path segments and query values this long may be keys; shorter ones ("v2", "rpc") are left alone. */
const MIN_SECRET_PART = 8;

/**
 * Every piece of `url` that could show up on its own: the URL as given and without a trailing slash, its origin and
 * host, its path and query together and apart, and each long path segment or query value. Longest first, so a
 * whole URL is replaced before its parts.
 */
export function urlParts(url: string): string[] {
  const parts = new Set<string>([url, url.replace(/\/+$/, "")]);
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    parts.add(parsed.href);
    parts.add(parsed.origin);
    parts.add(parsed.host);
    parts.add(parsed.hostname);
    if (parsed.pathname.length > 1) {
      parts.add(`${parsed.pathname}${parsed.search}`);
      parts.add(parsed.pathname);
      parts.add(parsed.pathname.replace(/\/+$/, ""));
    }
    if (parsed.search.length > 1) parts.add(parsed.search);
    for (const segment of parsed.pathname.split("/")) if (segment.length >= MIN_SECRET_PART) parts.add(segment);
    for (const value of parsed.searchParams.values()) if (value.length >= MIN_SECRET_PART) parts.add(value);
    if (parsed.username !== "") parts.add(parsed.username);
    if (parsed.password !== "") parts.add(parsed.password);
  }
  return [...parts].filter((part) => part.length > 1 && part !== "/").sort((a, b) => b.length - a.length);
}

/** `text` with every piece of `url` replaced by the placeholder. */
export function scrubUrl(text: string, url: string): string {
  let out = text;
  for (const part of urlParts(url)) out = out.split(part).join(URL_PLACEHOLDER);
  return out;
}

const secrets: string[] = [];

/** Registers a URL whose pieces `scrub` removes from now on. */
export function registerSecretUrl(url: string): void {
  if (url !== "" && !secrets.includes(url)) secrets.push(url);
}

/** `text` with every registered URL scrubbed. */
export function scrub(text: string): string {
  return secrets.reduce((out, url) => scrubUrl(out, url), text);
}

/** An Error whose message and stack are scrubbed, whatever was thrown; keeps a JSON-RPC error's `code` and `data`. */
export function scrubError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const clean = new Error(scrub(source.message)) as Error & { code?: unknown; data?: unknown };
  clean.stack = scrub(source.stack ?? clean.stack ?? "");
  const extra = source as { code?: unknown; data?: unknown };
  if (extra.code !== undefined) clean.code = extra.code;
  if (extra.data !== undefined) clean.data = typeof extra.data === "string" ? scrub(extra.data) : extra.data;
  return clean;
}
