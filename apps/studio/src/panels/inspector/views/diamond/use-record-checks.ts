/**
 * The Deployments list's record checks (spec L698). Reading a record sends its address to the chain's RPC, so it
 * happens only on a person's action: `deployments.show` (the status chip, which asks for this list), the list's
 * Check button, or a record's Retry. Each read says what it found: code at the address, none, or "Couldn't read
 * Sepolia for this record." with Retry. "Checking 2 deployments…" while reads are in flight. Offline, nothing
 * is read and the records show as stored.
 */
import type { Deployment } from "@lattice-studio/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChainAccess } from "../../shared/use-chain";
import { recordKey } from "./diamond-words";

/** `found`: the address holds code; `empty`: it doesn't; `failed`: the read failed. */
export type RecordCheck = "checking" | "found" | "empty" | "failed";

export type RecordChecks = {
  /** Reads in flight. */
  checking: number;
  /** Whether records can be read now (online, chain module loaded). */
  ready: boolean;
  /** The check of one record, by `recordKey`; undefined before its first read (and offline). */
  checkOf(record: Deployment): RecordCheck | undefined;
  /** Reads every record. */
  checkAll(): void;
  /** Reads one record again. */
  retry(record: Deployment): void;
};

export function useRecordChecks(
  records: readonly Deployment[] | null,
  access: ChainAccess,
  online: boolean,
  auto: boolean,
): RecordChecks {
  const service = access.status === "ready" ? access.service : null;
  const [checks, setChecks] = useState<ReadonlyMap<string, RecordCheck>>(() => new Map());
  const started = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const read = useCallback(
    (record: Deployment) => {
      if (!service) return;
      const key = recordKey(record);
      started.current.add(key);
      const settle = (next: RecordCheck) => {
        if (live.current) setChecks((current) => new Map(current).set(key, next));
      };
      settle("checking");
      service.codeAt(record.chainId, record.address).then(
        (result) => settle(!result.ok ? "failed" : result.value === "0x" ? "empty" : "found"),
        () => settle("failed"),
      );
    },
    [service],
  );

  // Asked for on open (deployments.show): each record once per chain service.
  useEffect(() => {
    if (!auto || !online || !service) return;
    for (const record of records ?? []) if (!started.current.has(recordKey(record))) read(record);
  }, [auto, records, online, service, read]);

  return useMemo(() => {
    const visible = online ? checks : new Map<string, RecordCheck>();
    const current = new Set(records?.map(recordKey) ?? []);
    let checking = 0;
    for (const [key, check] of visible) if (check === "checking" && current.has(key)) checking += 1;
    return {
      checking,
      ready: online && service !== null,
      checkOf: (record) => visible.get(recordKey(record)),
      checkAll: () => {
        for (const record of records ?? []) read(record);
      },
      retry: read,
    };
  }, [checks, online, records, read, service]);
}
