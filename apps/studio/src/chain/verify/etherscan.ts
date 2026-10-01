/**
 * The Etherscan API V2 client: one endpoint for every chain (`?chainid=`), `verifysourcecode` with the same
 * standard JSON Sourcify gets, then `checkverifystatus` on the GUID it returns. Pure request building and response
 * reading through the injected `VerifyFetch`.
 *
 * The API key goes in the form body only, never in the URL, and never into anything this module returns: a
 * network failure and a bad response get fixed words, known answers get house words, and any other server text
 * has the key cut out of it before it becomes a reason.
 *
 * Both calls are form-encoded POSTs with no custom header, so the browser sends them without a preflight.
 * Etherscan answers errors as HTTP 200 with `{ status: "0", result: "<why>" }`.
 */
import type { Address } from "@lattice-studio/core";
import type { VerifyFetch } from "./ports";

export const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

export type EtherscanSubmission = { stdJsonInput: unknown; compilerVersion: string; contractName: string };

/** A failure's `keyed` is true when the key or its plan caused it, so a changed key is worth another try. */
export type EtherscanFailure = { kind: "failed"; reason: string; keyed: boolean };

export type EtherscanSubmitted =
  | { kind: "queued"; guid: string }
  | { kind: "verified" }
  /** Not indexed yet, or rate limited: submit again later. */
  | { kind: "wait" }
  | EtherscanFailure;

export type EtherscanVerdict = { kind: "pending" } | { kind: "verified" } | EtherscanFailure;

/** "v0.8.36+commit.8a079791" from the catalog's long version; null when it carries no commit. */
export function etherscanCompilerVersion(version: string): string | null {
  const found = /^v?(\d+\.\d+\.\d+\+commit\.[0-9a-f]{8})/.exec(version.trim());
  return found ? `v${found[1]}` : null;
}

/** Etherscan rejects settings keys solc's own standard JSON doesn't define; the catalog's build carries these. */
const NON_STANDARD_SETTINGS = ["experimental", "viaSSACFG"];

function sourceCode(stdJsonInput: unknown): string {
  if (typeof stdJsonInput !== "object" || stdJsonInput === null) return JSON.stringify(stdJsonInput);
  const settings = (stdJsonInput as { settings?: unknown }).settings;
  if (typeof settings !== "object" || settings === null) return JSON.stringify(stdJsonInput);
  const kept = Object.fromEntries(Object.entries(settings).filter(([name]) => !NON_STANDARD_SETTINGS.includes(name)));
  return JSON.stringify({ ...stdJsonInput, settings: kept });
}

/** `text` with every occurrence of `key` cut out. */
export function scrub(text: string, key: string): string {
  return key === "" ? text : text.split(key).join("…");
}

function failureFor(result: string, key: string): EtherscanFailure {
  const text = result.toLowerCase();
  if (text.includes("invalid api key")) {
    return { kind: "failed", reason: "Etherscan rejected the API key. Check it in Settings → Deploy.", keyed: true };
  }
  if (text.includes("free api access is not supported")) {
    return { kind: "failed", reason: "Etherscan's free plan doesn't cover this chain.", keyed: true };
  }
  if (text.includes("community free api limit reached")) {
    return { kind: "failed", reason: "Etherscan's free daily limit is used up. Retry later.", keyed: true };
  }
  if (text.includes("missing or unsupported chainid")) {
    return { kind: "failed", reason: "Etherscan doesn't serve this chain.", keyed: false };
  }
  return { kind: "failed", reason: `Etherscan answered: ${scrub(result, key).slice(0, 200)}`, keyed: false };
}

type Answer = { status: string; result: string } | EtherscanFailure;

async function post(fetchImpl: VerifyFetch, baseUrl: string, chainId: number, fields: Record<string, string>): Promise<Answer> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}?chainid=${chainId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    return { kind: "failed", reason: "Couldn't reach Etherscan.", keyed: false };
  }
  if (!response.ok) return { kind: "failed", reason: `Etherscan answered ${response.status}.`, keyed: false };
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { kind: "failed", reason: "Etherscan's response wasn't valid JSON.", keyed: false };
  }
  const body = (typeof json === "object" && json !== null ? json : {}) as { status?: unknown; result?: unknown };
  return { status: String(body.status ?? ""), result: typeof body.result === "string" ? body.result : String(body.result ?? "") };
}

/** Starts a verification; `wait` means Etherscan can't take it yet and the same call is worth repeating. */
export async function submitToEtherscan(
  fetchImpl: VerifyFetch, baseUrl: string, key: string, chainId: number, address: Address, body: EtherscanSubmission,
): Promise<EtherscanSubmitted> {
  const answer = await post(fetchImpl, baseUrl, chainId, {
    apikey: key,
    module: "contract",
    action: "verifysourcecode",
    codeformat: "solidity-standard-json-input",
    sourceCode: sourceCode(body.stdJsonInput),
    contractaddress: address,
    contractname: body.contractName,
    compilerversion: body.compilerVersion,
  });
  if ("kind" in answer) return answer;
  const text = answer.result.toLowerCase();
  if (text.includes("already verified")) return { kind: "verified" };
  if (answer.status === "1" && answer.result !== "") return { kind: "queued", guid: answer.result };
  if (text.startsWith("unable to locate contractcode") || text.startsWith("max rate limit reached")) return { kind: "wait" };
  return failureFor(answer.result, key);
}

/** Reads one submission's status. Anything Etherscan doesn't call a failure keeps it pending. */
export async function pollEtherscan(
  fetchImpl: VerifyFetch, baseUrl: string, key: string, chainId: number, guid: string,
): Promise<EtherscanVerdict> {
  const answer = await post(fetchImpl, baseUrl, chainId, { apikey: key, module: "contract", action: "checkverifystatus", guid });
  if ("kind" in answer) return answer;
  const text = answer.result.toLowerCase();
  if (text.startsWith("pass - verified") || text.includes("already verified")) return { kind: "verified" };
  if (
    text.startsWith("pending in queue") || text.startsWith("error: contract does not exist") ||
    text.startsWith("max rate limit reached")
  ) {
    return { kind: "pending" };
  }
  if (answer.status === "1") return { kind: "pending" };
  return failureFor(answer.result, key);
}
