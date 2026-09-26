/**
 * The Sourcify API v2 client (spec L26 decision 14, L577): `POST /v2/verify/{chainId}/{address}` starts a job and
 * returns a `verificationId` to poll at `GET /v2/verify/{id}`. Pure request building and response reading: every
 * call goes through the injected `VerifyFetch`, so tests script exact responses instead of a live server.
 *
 * Schema (Sourcify's `api-docs/swagger.json`, apiv2): the job carries `isJobCompleted`, a `contract` object whose
 * `match`/`creationMatch`/`runtimeMatch` are `"exact_match" | "match" | null`, and, only on failure, an `error`
 * object with `message`. The proxy has no constructor arguments or immutables, so `runtimeMatch` alone is enough
 * for a diamond the factory created (spec L577); `creationMatch` needs a creation transaction Studio may not have
 * (a From file record, or a Safe proposal) and would otherwise report a false failure.
 */
import type { Address, Hex, Result } from "@lattice-studio/core";
import { err, ok } from "@lattice-studio/core";
import type { VerifyFetch } from "./ports";

export const SOURCIFY_BASE = "https://sourcify.dev/server";

export type SourcifySubmission = {
  stdJsonInput: unknown;
  compilerVersion: string;
  contractIdentifier: string;
  creationTransactionHash?: Hex;
};

export type SourcifyVerdict =
  | { kind: "pending" }
  | { kind: "verified"; match: "exact_match" | "match" }
  | { kind: "failed"; reason: string };

function networkError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The reason from a Sourcify error body, or its status when the body doesn't say. */
async function errorReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown } | null;
    const inner = body && typeof body === "object" ? body.error : undefined;
    if (typeof inner === "string") return inner;
    if (inner && typeof inner === "object" && typeof (inner as { message?: unknown }).message === "string") {
      return (inner as { message: string }).message;
    }
    if (body && typeof body.message === "string") return body.message;
  } catch {
    // No JSON body: fall through to the status line.
  }
  return `Sourcify answered ${response.status}.`;
}

/** Starts a verification job; the value is the id to poll. */
export async function submitToSourcify(
  fetchImpl: VerifyFetch,
  baseUrl: string,
  chainId: number,
  address: Address,
  body: SourcifySubmission,
): Promise<Result<string, string>> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v2/verify/${chainId}/${address}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return err(networkError(error));
  }
  if (response.status !== 200 && response.status !== 202) return err(await errorReason(response));
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return err("Sourcify's response wasn't valid JSON.");
  }
  const id = (json as { verificationId?: unknown } | null)?.verificationId;
  return typeof id === "string" && id.length > 0 ? ok(id) : err("Sourcify didn't return a verification id.");
}

function readVerdict(json: unknown): SourcifyVerdict {
  const body = json as {
    isJobCompleted?: unknown;
    contract?: { runtimeMatch?: unknown } | null;
    error?: { message?: unknown } | null;
  } | null;
  if (!body || body.isJobCompleted !== true) return { kind: "pending" };
  const reason = body.error?.message;
  if (typeof reason === "string" && reason.length > 0) return { kind: "failed", reason };
  const runtimeMatch = body.contract?.runtimeMatch;
  if (runtimeMatch === "exact_match" || runtimeMatch === "match") return { kind: "verified", match: runtimeMatch };
  return { kind: "failed", reason: "Sourcify found no match for this contract." };
}

/** Reads one job's status; `pending` while `isJobCompleted` is false. */
export async function pollSourcify(fetchImpl: VerifyFetch, baseUrl: string, verificationId: string): Promise<Result<SourcifyVerdict, string>> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v2/verify/${verificationId}`);
  } catch (error) {
    return err(networkError(error));
  }
  if (!response.ok) return err(await errorReason(response));
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return err("Sourcify's response wasn't valid JSON.");
  }
  return ok(readVerdict(json));
}
