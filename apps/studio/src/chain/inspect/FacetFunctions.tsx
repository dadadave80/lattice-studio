import type { Catalog, Facet, FacetDetail, PassportIdentifiedFacet, Result } from "@lattice-studio/core";
import { useEffect, useMemo, useState } from "react";
import type { Abi } from "viem";
import { Section } from "@/panels/inspector/shared/Section";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button } from "@/ui";
import { Identifier } from "@/ui/text/Identifier";
import { routedFunctions, type RoutedFunction } from "./abi";
import { CallForm } from "./CallForm";
import type { CallController, PreparedCall } from "./calls";
import { inspectionDetails } from "./details";
import type { ReadyInspection } from "./engine";
import styles from "./CallForm.module.css";

type Props = {
  value: ReadyInspection; facet: PassportIdentifiedFacet; metadata: Facet; catalog: Catalog;
  controller?: CallController;
  loadDetail?(catalog: Catalog, facet: Facet): Promise<Result<FacetDetail, string>>;
  onReview?(prepared: PreparedCall, fn: RoutedFunction, abi: Abi): void | Promise<void>;
  onEdit?(): void;
};

function FunctionRow({ value, fn, abi, controller, onReview, onEdit }: Omit<Props, "facet" | "metadata" | "catalog" | "loadDetail"> & { fn: RoutedFunction; abi: Abi }) {
  const [open, setOpen] = useState(false);
  const context = useMemo(() => ({
    chainId: value.target.chainId, address: value.target.address, block: value.snapshot.block,
    blockHash: value.snapshot.blockHash, identity: value.identity, fn, abi,
  }), [value.target.chainId, value.target.address, value.snapshot.block, value.snapshot.blockHash, value.identity, fn, abi]);
  return <details className={styles.function} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><Identifier text={fn.signature} />{` · ${fn.abi.stateMutability}`}</summary>
    {open ? <CallForm context={context} {...(controller ? { controller } : {})} {...(onReview ? { onReview: (prepared) => onReview(prepared, fn, abi) } : {})} {...(onEdit ? { onEdit } : {})} /> : null}
  </details>;
}

/** ABI functions come only from this identified release's hash-verified shard and current loupe selectors. */
export function FacetFunctions({ value, facet, metadata, catalog, controller, loadDetail = inspectionDetails.load, onReview, onEdit }: Props) {
  const [attempt, setAttempt] = useState(0);
  const detailKey = `${catalog.hash}:${metadata.detail.hash}:${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; result: Result<FacetDetail, string> } | null>(null);
  const detail = loaded?.key === detailKey ? loaded.result : null;
  useEffect(() => {
    let current = true;
    void loadDetail(catalog, metadata).then((result) => { if (current) setLoaded({ key: detailKey, result }); });
    return () => { current = false; };
  }, [catalog, metadata, loadDetail, detailKey]);
  const rows = useMemo(() => detail?.ok ? routedFunctions(detail.value.abi as Abi, facet.selectors) : [], [detail, facet.selectors]);
  if (!detail || !detail.ok) return <Section label="Functions">
    {!detail ? <output className={sheet.text}>Loading the verified ABI…</output> : <><p className={sheet.text}>{detail.error}</p><Button size="small" onClick={() => setAttempt((value) => value + 1)}>Retry loading functions</Button></>}
  </Section>;
  const abi = detail.value.abi as Abi;
  const missing = facet.selectors.filter((selector) => !rows.some((row) => row.selector.toLowerCase() === selector.toLowerCase())).length;
  return <>
    {([true, false] as const).map((readOnly) => <Section key={String(readOnly)} label={readOnly ? "Read functions" : "Write functions"} aside={rows.filter((row) => row.readOnly === readOnly).length}>
      {rows.filter((row) => row.readOnly === readOnly).map((fn) => <FunctionRow key={fn.signature} value={value} fn={fn} abi={abi}
        {...(controller ? { controller } : {})} {...(onReview ? { onReview } : {})} {...(onEdit ? { onEdit } : {})} />)}
      {!rows.some((row) => row.readOnly === readOnly) ? <p className={sheet.muted}>{readOnly ? "No routed read functions in this ABI." : "No routed write functions in this ABI."}</p> : null}
    </Section>)}
    {missing ? <Section label="Unknown signatures"><p className={sheet.muted}>{`${missing} routed ${missing === 1 ? "selector has" : "selectors have"} no function in this verified ABI. They are shown as raw selectors above.`}</p></Section> : null}
  </>;
}
