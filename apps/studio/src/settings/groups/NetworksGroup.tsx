import { isNotImplemented } from "@lattice-studio/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { chainService, settings, useSettings, type ChainInfo, type ChainReadiness, type ChainService } from "@/contracts";
import { TextField } from "@/ui";
import styles from "./NetworksGroup.module.css";

function looksLikeRpcUrl(value: string): boolean {
  if (!value) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" || protocol === "ws:" || protocol === "wss:";
  } catch {
    return false;
  }
}

function readinessText(readiness: ChainReadiness, name: string): string {
  switch (readiness.status) {
    case "unknown":
      return "Checking…";
    case "checking":
      return "Checking…";
    case "ready":
      return "Ready";
    case "error":
      return `Couldn't read ${name}: ${readiness.reason}`;
  }
}

function ChainRow({ chain, service }: { chain: ChainInfo; service: ChainService }) {
  const rpc = useSettings((s) => s.rpc);
  const readiness = useSyncExternalStore(
    (onChange) =>
      service.subscribeReadiness((chainId) => {
        if (chainId === chain.id) onChange();
      }),
    () => service.readiness(chain.id),
  );
  const value = rpc[chain.id] ?? "";

  useEffect(() => {
    void service.probe(chain.id);
  }, [service, chain.id]);

  const onChange = (next: string) => {
    const current = settings.get().rpc;
    if (next === "") {
      const { [chain.id]: _removed, ...rest } = current;
      settings.set({ rpc: rest });
      return;
    }
    settings.set({ rpc: { ...current, [chain.id]: next } });
  };

  return (
    <div className={styles.row}>
      <TextField
        label={`${chain.name} RPC override`}
        value={value}
        onValueChange={onChange}
        {...(looksLikeRpcUrl(value) ? {} : { description: "This won't be used: it needs an http(s) or ws(s) URL." })}
      />
      <p className={styles.readiness}>{readinessText(readiness, chain.name)}</p>
    </div>
  );
}

/**
 * Settings → Networks (Flow 16 L629): chain list with RPC overrides and readiness. Reads the lazy chain
 * module (S8a); until it lands, `chainService()` rejects with `NotImplemented`, shown as plain text
 * (spec L661, no silent no-ops; PA L72-L84, no board yet).
 */
export function NetworksGroup() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; service: ChainService }>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    chainService().then(
      (service) => {
        if (!cancelled) setState({ status: "ready", service });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: isNotImplemented(error) ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {state.status === "error" ? <p className={styles.note}>{state.message}</p> : null}
      {state.status === "ready"
        ? state.service.chains().map((chain) => <ChainRow key={chain.id} chain={chain} service={state.service} />)
        : null}
      <p className={styles.note}>Custom chains arrive in v1.1.</p>
    </>
  );
}
