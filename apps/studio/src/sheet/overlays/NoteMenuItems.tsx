import type { CommandRef, Hex4 } from "@lattice-studio/core";
import { useCommandState } from "@/contracts";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import type { NoteModel } from "./note-model";
import { routeRef, routeSet } from "./set-route";

function SetRouteItem({ selectors, facet, verb }: { selectors: readonly Hex4[]; facet: string; verb?: "keep" }) {
  const state = useCommandState(routeRef(selectors[0], facet, verb), "menu");
  return (
    <MenuItem
      label={state.title}
      disabledReason={state.ok ? null : state.reason}
      onSelect={() => routeSet(selectors, facet, verb, "menu")}
    />
  );
}

export type NoteMenuItemsProps = {
  note: NoteModel;
  /** The fixes as the note shows them (a Place fix carries where to land). */
  fixes: readonly CommandRef[];
  /** The card Go to card locates, when one is on the sheet. */
  card: string | undefined;
};

/** A note's context menu (IR L196): the note's fixes, then Go to card. */
export function NoteMenuItems({ note, fixes, card }: NoteMenuItemsProps) {
  const selectors = note.selectors.map((s) => s.hex);
  const [a, b] = note.contenders;
  const items =
    note.kind === "collision" ? (
      <>
        {note.contenders.length === 2 && a !== undefined && b !== undefined ? (
          <>
            <SetRouteItem selectors={selectors} facet={a} verb="keep" />
            <SetRouteItem selectors={selectors} facet={b} />
          </>
        ) : (
          note.contenders.map((facet) => <SetRouteItem key={facet} selectors={selectors} facet={facet} />)
        )}
        {selectors.length > 1 ? <MenuCommandItem command={{ id: "collision.choosePerSelector", args: { selectors } }} /> : null}
      </>
    ) : (
      fixes.map((fix) => <MenuCommandItem key={JSON.stringify(fix)} command={fix} />)
    );
  return (
    <>
      {items}
      {card !== undefined ? (
        <>
          <MenuSeparator />
          <MenuCommandItem command={{ id: "sheet.locate", args: { facet: card } }} label="Go to card" icon="locate" />
        </>
      ) : null}
    </>
  );
}
