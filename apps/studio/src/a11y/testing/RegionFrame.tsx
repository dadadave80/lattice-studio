import type { ReactNode } from "react";
import { REGION_LABELS, useDocument, useRegion, type RegionId } from "@/contracts";
import { readingOrder } from "../positions";

type Props = {
  /** Toasts showing in the toasts region (S10's viewport stays mounted and holds one element per toast). */
  toasts?: string[];
  /** Regions rendered hidden, as a closed drawer is. */
  hidden?: RegionId[];
};

function Region({ id, hidden, children }: { id: RegionId; hidden: boolean; children?: ReactNode }) {
  const props = useRegion(id);
  return (
    <section {...props} hidden={hidden}>
      {children ?? <button type="button">{`${REGION_LABELS[id]} control`}</button>}
    </section>
  );
}

/** Cards from the document's layout, in reading order, the way S4b renders React Flow nodes. */
function Cards() {
  const layout = useDocument((s) => s.project.layout);
  return (
    <div role="application" aria-label="Diamond sheet">
      {readingOrder(layout).map((name) => (
        <fieldset key={name} className="react-flow__node" data-id={name} tabIndex={-1} aria-label={name}>
          {name}
        </fieldset>
      ))}
    </div>
  );
}

/** Test stand-in for the app: the six regions through `useRegion`, with cards on the sheet. */
export function RegionFrame({ toasts = [], hidden = [] }: Props) {
  return (
    <>
      <Region id="titlebar" hidden={hidden.includes("titlebar")} />
      <Region id="left" hidden={hidden.includes("left")} />
      <Region id="sheet" hidden={hidden.includes("sheet")}>
        <Cards />
      </Region>
      <Region id="inspector" hidden={hidden.includes("inspector")} />
      <Region id="console" hidden={hidden.includes("console")} />
      <Region id="toasts" hidden={hidden.includes("toasts")}>
        {toasts.map((text) => (
          <div key={text}>{text}</div>
        ))}
      </Region>
    </>
  );
}
