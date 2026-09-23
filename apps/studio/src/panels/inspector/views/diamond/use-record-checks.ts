/**
 * The Deployments list's record checks (spec L698): while online and the chain module is ready, each record is
 * read once with `codeAt`; "Checking 2 deployments…" while reads are in flight, and a failed read marks its
 * record ("Couldn't read Sepolia for this record.") until Retry reads it again. Offline, nothing is read and
 * the records show as stored.
 */
import type { Deployment } from "@lattice-studio/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChainAccess } from "../../shared/use-chain";
import { recordKey } from "./diamond-words";

export type RecordCheck = "checking" | "read" | "failed";

export type RecordChecks = {
  /** Reads in flight. */
  checking: number;
  /** The check of one record, by `recordKey`; undefined before its first read (and offline). */
  checkOf(record: Deployment): RecordCheck | undefined;
  /** Reads one record again. */
  retry(record: Deployment): void;
};

export function useRecordChecks(records: readonly Deployment[] | null, access: ChainAccess, online: boolean): RecordChecks {
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
      const settle = (next: RecordCheck) => {
        if (live.current) setChecks((current) => new Map(current).set(key, next));
      };
      settle("checking");
      service.codeAt(record.chainId, record.address).then(
        (result) => settle(result.ok ? "read" : "failed"),
        () => settle("failed"),
      );
    },
    [service],
  );

  // Each record is read once per chain service; a re-read of the store doesn't read the chain again.
  useEffect(() => {
    if (!online || !service) return;
    for (const record of records ?? []) {
      const key = recordKey(record);
      if (started.current.has(key)) continue;
      started.current.add(key);
      read(record);
    }
  }, [records, online, service, read]);

  return useMemo(() => {
    const visible = online ? checks : new Map<string, RecordCheck>();
    const current = new Set(records?.map(recordKey) ?? []);
    let checking = 0;
    for (const [key, check] of visible) if (check === "checking" && current.has(key)) checking += 1;
    return {
      checking,
      checkOf: (record) => visible.get(recordKey(record)),
      retry: read,
    };
  }, [checks, online, records, read]);
}
