/**
 * Which Etherscan API key verification uses: the one typed in Settings, else this build's. These two functions
 * are the only readers of either. The key goes to Etherscan's API and nowhere else: never into a record, a
 * console line, an error or an export.
 */
import { env, settings } from "@/contracts";

/**
 * This build's key. Vitest never sees it: a developer's own `.env` must not change what a test renders, or send
 * a test's request to the real API.
 */
function buildKey(): string | undefined {
  return env.test ? undefined : env.etherscanApiKey;
}

/** The Settings value when it has one, else the build's; undefined when Etherscan verification isn't set up. */
export function etherscanKeyFrom(setting: string, build: string | undefined = buildKey()): string | undefined {
  return setting.trim() || build?.trim() || undefined;
}

/** `etherscanKeyFrom` over the live settings, for code outside render. */
export function etherscanKey(): string | undefined {
  return etherscanKeyFrom(settings.get().etherscanApiKey);
}
