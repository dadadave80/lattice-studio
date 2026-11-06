import type { Result } from "@lattice-studio/core";

export type InspectionTargetInput = { chainId: number; target: string };

/** Parses the envelope; only dialog input supplies selectedChain. Address/ENS validation belongs to the chain service. */
export function parseInspectionTarget(input: string, selectedChain?: number): Result<InspectionTargetInput, string> {
  let value = input.trim();
  let linked = false;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "This isn't a diamond link." };
      value = url.hash;
      if (!value.startsWith("#d=") && !value.startsWith("#open=")) return { ok: false, error: "This isn't a diamond link." };
    } catch {
      return { ok: false, error: "This isn't a diamond link." };
    }
  }
  if (value.startsWith("#d=") || value.startsWith("#open=")) {
    linked = true;
    try {
      value = decodeURIComponent(value.slice(value.indexOf("=") + 1));
    } catch {
      return { ok: false, error: "This diamond link has invalid encoding." };
    }
  } else if (value.startsWith("#")) {
    return { ok: false, error: "This isn't a diamond link." };
  }
  if (value.startsWith("eip155:")) {
    linked = true;
    value = value.slice("eip155:".length);
  }
  const parts = /^(\d+):([\s\S]*)$/.exec(value);
  const chainId = parts ? Number(parts[1]) : linked || value.includes(":") ? undefined : selectedChain;
  if (chainId === undefined || !Number.isSafeInteger(chainId) || chainId <= 0) {
    return { ok: false, error: "Choose a chain, or use a diamond link with a chain id." };
  }
  const target = (parts?.[2] ?? value).trim();
  if (!target) return { ok: false, error: "Enter a diamond address or ENS name." };
  return { ok: true, value: { chainId, target } };
}
