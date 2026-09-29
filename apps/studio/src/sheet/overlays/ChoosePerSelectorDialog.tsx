import type { Hex4 } from "@lattice-studio/core";
import { useId, useRef, useState } from "react";
import { closeDialog, useAnalysis, useCatalog, useSession, type DialogComponentProps } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Icon } from "@/ui/icons/Icon";
import { Dialog } from "@/ui/overlays/Dialog";
import { Menu } from "@/ui/overlays/Menu";
import { MenuRadioGroup } from "@/ui/overlays/MenuRadioGroup";
import { MenuRadioItem } from "@/ui/overlays/MenuRadioItem";
import { applyOwners } from "./owners";
import styles from "./ChoosePerSelectorDialog.module.css";

const TITLE = "Choose per selector";

type Row = { hex: Hex4; signature: string; contenders: string[]; owner: string | undefined };

function OwnerChoice({ row, value, onChange }: { row: Row; value: string | undefined; onChange: (facet: string) => void }) {
  const id = useId();
  return (
    <li className={styles.row}>
      <span id={`${id}-selector`} className={styles.selector}>
        <code className={styles.signature}>{row.signature}</code> <span className={styles.hex}>{row.hex}</span>
      </span>
      <Menu
        label={`Owner of ${row.signature}`}
        align="end"
        trigger={
          <Button size="small" aria-describedby={`${id}-selector`} data-owner-menu={row.hex}>
            {value === undefined ? "Choose owner" : `Owner: ${value}`}
            <Icon name="chevron-down" size="small" />
          </Button>
        }
      >
        <MenuRadioGroup value={value ?? ""} onValueChange={onChange}>
          {row.contenders.map((facet) => (
            <MenuRadioItem key={facet} value={facet} label={facet} />
          ))}
        </MenuRadioGroup>
      </Menu>
    </li>
  );
}

/**
 * Choose per selector (spec L435, IR L176): one owner menu per contested selector, then Apply owners as one undo
 * step. Opens from a collision note (and, for one selector with three or more contenders, from its pin, as
 * Choose owner…). Like every editing command, Apply owners says the read-only reason while one is set.
 */
export function ChoosePerSelectorDialog({ entry, top }: DialogComponentProps<"choose-per-selector">) {
  const catalog = useCatalog();
  const routing = useAnalysis((a) => a.routing);
  const readOnly = useSession((s) => s.readOnly);
  const bodyRef = useRef<HTMLUListElement>(null);
  const rows: Row[] = entry.props.selectors.map((hex) => {
    const route = routing[hex];
    const signature = catalog?.facets.flatMap((f) => f.selectors).find((s) => s.hex === hex)?.signature ?? hex;
    return { hex, signature, contenders: route?.contenders ?? [], owner: route?.owner };
  });
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({});
  const close = () => closeDialog("choose-per-selector");
  const choices = rows.flatMap((row) => {
    const facet = draft[row.hex];
    return facet !== undefined && facet !== row.owner ? [{ selector: row.hex, facet }] : [];
  });
  const reason = readOnly ?? (catalog ? null : "The catalog hasn't loaded yet · Wait for it to finish") ?? (choices.length === 0 ? "Choose an owner first" : null);

  const apply = () => {
    if (reason !== null) return;
    if (applyOwners(choices)) close();
  };

  return (
    <Dialog
      open
      top={top}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={TITLE}
      description="Only one facet can serve each selector."
      initialFocus={() => bodyRef.current?.querySelector<HTMLElement>("[data-owner-menu]") ?? null}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabledReason={reason} onClick={apply}>
            Apply owners
          </Button>
        </>
      }
    >
      <ul ref={bodyRef} className={styles.list}>
        {rows.map((row) => (
          <OwnerChoice
            key={row.hex}
            row={row}
            value={draft[row.hex] ?? row.owner}
            onChange={(facet) => setDraft((d) => ({ ...d, [row.hex]: facet }))}
          />
        ))}
      </ul>
    </Dialog>
  );
}
