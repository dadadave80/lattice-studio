/**
 * Which Etherscan API key verification uses: the one typed in Settings, else this build's. The functions here
 * are the only readers of either. The key goes to Etherscan's API and nowhere else: never into a record, a
 * console line, an error or an export.
 */
import { env, settings } from "@/contracts";

/**
 * This build's key. Vitest and the end-to-end build never see it: a developer's own `.env` must not change what a
 * test renders, or send a test's request to the real API.
 */
export function etherscanBuildKey(
  flags: { readonly test: boolean; readonly e2e: boolean; readonly etherscanApiKey: string | undefined } = env,
): string | undefined {
  return flags.test || flags.e2e ? undefined : flags.etherscanApiKey;
}

/** The Settings value when it has one, else the build's; undefined when Etherscan verification isn't set up. */
export function etherscanKeyFrom(setting: string, build: string | undefined): string | undefined {
  return setting.trim() || build?.trim() || undefined;
}

/** `etherscanKeyFrom` over the live settings and this build, for code outside render. */
export function etherscanKey(): string | undefined {
  return etherscanKeyFrom(settings.get().etherscanApiKey, etherscanBuildKey());
}
