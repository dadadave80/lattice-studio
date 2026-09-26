import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { env, settings, useSettings, type ChainReadiness, type ChainService } from "@/contracts";
import { chainLoader, checking, couldntRead, isRpcUrl, pickerChains, useChainLoad, type ChainLoader } from "@/chain/infra";
import { Button, TextField } from "@/ui";
import styles from "./NetworksGroup.module.css";

/** Never re-created: `useSyncExternalStore`'s snapshot before anything has probed this chain, or off the runtime. */
const UNKNOWN: ChainReadiness = { status: "unknown" };

function readinessText(readiness: ChainReadiness, name: string): string {
  switch (readiness.status) {
    case "unknown":
      return "Not checked yet.";
    case "checking":
      return checking(name);
    case "ready":
      return "Ready";
    case "error":
      return couldntRead(name);
  }
}

function ChainRow({
  chain, service, onCheck,
}: {
  chain: { id: number; name: string };
  service: ChainService | null;
  onCheck: () => void;
}) {
  const stored = useSettings((s) => s.rpc[chain.id] ?? "");
  const [draft, setDraft] = useState(stored);
  // The setting can change from outside this field (another tab, a reset): adjusted during render (the
  // documented React pattern), not an effect, so it never shows a stale value for even one frame.
  const [syncedWith, setSyncedWith] = useState(stored);
  if (stored !== syncedWith) {
    setSyncedWith(stored);
    setDraft(stored);
  }
  const valid = draft === "" || isRpcUrl(draft);

  const subscribe = useCallback(
    (onChange: () => void) =>
      service ? service.subscribeReadiness((id) => id === chain.id && onChange()) : () => {},
    [service, chain.id],
  );
  const getSnapshot = useCallback(() => {
    if (!service) return UNKNOWN;
    const readiness = service.readiness(chain.id);
    // A service's own "unknown" (no probe yet) isn't guaranteed to be the same object twice; normalize to
    // the one stable constant so `useSyncExternalStore` never sees a snapshot that "changed" when it didn't.
    return readiness.status === "unknown" ? UNKNOWN : readiness;
  }, [service, chain.id]);
  const readiness = useSyncExternalStore(subscribe, getSnapshot);

  const onChange = (next: string) => {
    setDraft(next);
    // Spec D13: opening Settings never loads the chain runtime or writes a guess; an override that isn't a
    // URL Studio would call stays local (and shows why) until it validates, instead of landing in `settings.rpc`.
    if (next === "") {
      const { [chain.id]: _removed, ...rest } = settings.get().rpc;
      settings.set({ rpc: rest });
    } else if (isRpcUrl(next)) {
      settings.set({ rpc: { ...settings.get().rpc, [chain.id]: next } });
    }
  };

  return (
    <div className={styles.row}>
      <TextField
        label={`${chain.name} RPC override`}
        value={draft}
        onValueChange={onChange}
        {...(valid ? {} : { description: "This won't be used: it needs a valid http(s) URL." })}
      />
      {service ? (
        <p className={styles.readiness}>{readinessText(readiness, chain.name)}</p>
      ) : (
        <Button size="small" onClick={onCheck}>
          Check {chain.name}
        </Button>
      )}
    </div>
  );
}

/**
 * Settings → Networks (Flow 16 L629): the chain list and RPC overrides, from S8a's static `pickerChains` —
 * opening this group must not load the chain runtime or probe every chain (spec D13: the runtime loads when
 * a chain is selected or a deploy starts). Readiness shows only once `useChainLoad` says the runtime is
 * already up (loaded for some other reason, in this session, or by an earlier Check here); otherwise each
 * row offers Check, which loads the runtime and probes just that one chain. `loader` defaults to S8a's one
 * real loader; tests inject their own so this group never touches the lazy chain module by itself.
 * No board yet (PA L72-L84).
 */
export function NetworksGroup({ loader = chainLoader }: { loader?: ChainLoader } = {}) {
  const load = useChainLoad(loader);
  const [service, setService] = useState<ChainService | null>(null);

  useEffect(() => {
    // Ready is terminal (a loaded runtime is never unloaded): once `service` is set there's nothing further
    // to synchronize, so this never needs to reset it back to null.
    if (load.status !== "ready" || service) return;
    let cancelled = false;
    void loader.load().then((svc) => {
      if (!cancelled) setService(svc);
    });
    return () => {
      cancelled = true;
    };
  }, [load.status, service, loader]);

  const chains = pickerChains(env.e2e);

  return (
    <>
      {chains.map((chain) => (
        <ChainRow
          key={chain.id}
          chain={chain}
          service={service}
          onCheck={() => void loader.load().then((svc) => svc.probe(chain.id))}
        />
      ))}
      <p className={styles.note}>Custom chains arrive in v1.1.</p>
    </>
  );
}
