import type { Result } from "@lattice-studio/core";
import { useEffect, useRef, useState } from "react";
import { announce, openShareLink, session, toast, type ChainInfo, type InspectorView } from "@/contracts";
import { requestInspectorFocus } from "@/panels/inspector/focus-request";
import { pickProjectFile } from "@/projects/file-io";
import { Button, Dialog, Select, TextField } from "@/ui";
import { parseInspectionTarget, type InspectionTargetInput } from "./target";
import styles from "./OpenDiamondDialog.module.css";

export type OpenDiamondDialogProps = {
  chains: readonly ChainInfo[];
  initialTarget?: string;
  initialChainId?: number | null;
  top?: boolean;
  onInspect(input: InspectionTargetInput, signal: AbortSignal): Promise<Result<void, string>>;
  onClose(): void;
};

function isShareLink(input: string): boolean {
  const value = input.trim();
  if (value.startsWith("#s=")) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hash.startsWith("#s=");
  } catch {
    return false;
  }
}

/** Inspection stays separate from the recipe; files and share links use the existing guarded import paths. */
export function OpenDiamondDialog({ chains, initialTarget = "", initialChainId, top = true, onInspect, onClose }: OpenDiamondDialogProps) {
  const [target, setTarget] = useState(initialTarget);
  const [chainId, setChainId] = useState<number | null>(() => {
    const embedded = parseInspectionTarget(initialTarget);
    return embedded.ok ? embedded.value.chainId : initialChainId ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"inspect" | "file" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fileButton = useRef<HTMLButtonElement>(null);
  const pending = useRef<AbortController | null>(null);
  const inspectedView = useRef<InspectorView>(null);
  const shared = isShareLink(target);
  const embedded = parseInspectionTarget(target);
  const chosenChain = embedded.ok ? embedded.value.chainId : chainId;

  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  const stop = () => {
    pending.current?.abort();
    pending.current = null;
    setWorking(null);
  };
  const close = () => {
    stop();
    onClose();
  };
  const showError = (message: string) => {
    setError(message);
    announce(message, { politeness: "assertive" });
    input.current?.focus();
  };
  const current = (request: AbortController) => pending.current === request && !request.signal.aborted;
  const begin = (kind: "inspect" | "file") => {
    stop();
    const request = new AbortController();
    pending.current = request;
    setWorking(kind);
    setError(null);
    return request;
  };

  const inspect = async () => {
    if (pending.current) return;
    if (shared) {
      close();
      openShareLink(target.trim());
      return;
    }
    const parsed = parseInspectionTarget(target, chainId ?? undefined);
    if (!parsed.ok) return showError(parsed.error);
    if (!chains.some((chain) => chain.id === parsed.value.chainId && chain.testnet)) {
      return showError(`Studio doesn't support chain ${parsed.value.chainId} yet.`);
    }
    const request = begin("inspect");
    try {
      const result = await onInspect(parsed.value, request.signal);
      if (!current(request)) return;
      pending.current = null;
      setWorking(null);
      if (result.ok) {
        const view = session.get().panes.inspector.view;
        if (view?.kind === "deployed") inspectedView.current = view;
        onClose();
      }
      else showError(result.error);
    } catch {
      if (!current(request)) return;
      pending.current = null;
      setWorking(null);
      showError("This diamond couldn't be inspected. Try again.");
    }
  };

  const openFile = async () => {
    if (working === "file") return;
    const request = begin("file");
    try {
      const picked = await pickProjectFile();
      if (!current(request)) return;
      if (!picked) {
        pending.current = null;
        setWorking(null);
        fileButton.current?.focus();
        return;
      }
      const { openImportedFile } = await import("@/projects/import-file");
      if (!current(request)) return;
      // Once handed off, the importer owns save protection and outcome reporting; closing is intentional.
      pending.current = null;
      onClose();
      void openImportedFile(picked.filename, picked.text).catch(() => toast({ text: "The file couldn't be opened. Try again.", kind: "error" }));
    } catch {
      if (!current(request)) return;
      pending.current = null;
      setWorking(null);
      showError("The file couldn't be opened. Try again.");
    }
  };

  return (
    <Dialog
      open
      title="Open"
      description="Inspect an on-chain diamond. Files and share links open as new projects."
      top={top}
      lossless
      initialFocus={input}
      restoreFocus={() => {
        const view = inspectedView.current;
        if (view === null || session.get().panes.inspector.view !== view) return true;
        // Base UI invokes this as its focus manager tears down. The modal's inert background clears
        // before the microtask; a lazy Inspector can consume the same request when its heading mounts.
        queueMicrotask(() => { if (session.get().panes.inspector.view === view) requestInspectorFocus({ kind: "heading" }); });
        return false;
      }}
      onOpenChange={(open) => { if (!open) close(); }}
      footer={<>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabledReason={working === "inspect" ? "Inspecting diamond…" : working === "file" ? "Opening a file…" : null} onClick={() => void inspect()}>
          {shared ? "Open shared project" : "Inspect diamond"}
        </Button>
      </>}
    >
      <div className={styles.fields}>
        <TextField
          label="Address, name or link"
          value={target}
          inputRef={input}
          mono
          autoComplete="off"
          placeholder="0x… or alice.eth"
          description="Paste a diamond address, ENS name, diamond link or Studio share link."
          error={error}
          onValueChange={(value) => {
            stop();
            setError(null);
            setTarget(value);
            const next = parseInspectionTarget(value);
            if (next.ok) setChainId(next.value.chainId);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void inspect();
            }
          }}
        />
        {!shared ? <Select
          label="Chain"
          options={chains.filter((chain) => chain.testnet).map((chain) => ({ value: String(chain.id), label: chain.name }))}
          value={chosenChain === null ? null : String(chosenChain)}
          placeholder="Choose a chain"
          disabledReason={embedded.ok ? "The diamond link specifies this chain. Edit the link to change it." : null}
          onValueChange={(value) => {
            stop();
            setError(null);
            setChainId(Number(value));
          }}
        /> : null}
        {working ? <output className={styles.status}>{working === "inspect" ? "Inspecting diamond…" : "Opening a file…"}</output> : null}
        <div className={styles.file}>
          <Button ref={fileButton} disabledReason={working === "file" ? "Opening a file…" : null} onClick={() => void openFile()}>Open file…</Button>
          <p className={styles.note}>Choose a Studio project or recipe JSON file.</p>
        </div>
      </div>
    </Dialog>
  );
}
