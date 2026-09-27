import type { Catalog, Facet } from "@lattice-studio/core";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { KEY_CONTEXT_ATTRIBUTE, useAnalysis, useDocument } from "@/contracts";
import { TextField } from "@/ui";
import { useInspectorFocus } from "../../focus-request";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { pinAction } from "./pin-action";
import { SelectorRow } from "./SelectorRow";
import styles from "./facet.module.css";

export type SelectorListProps = {
  facet: Facet;
  catalog: Catalog;
  /** Catalog preview: rows are plain text with their state. */
  readOnly: boolean;
};

/**
 * The facet's exported selectors with a filter (IR L118). Interactive, its rows are one Tab stop: ↑/↓/Home/End
 * move between them, Enter or Space does what the row's tooltip says (Flow 6). inspector.focusSelectors lands
 * on the first row. Tab from the active row reaches its actions menu (Copy selector, Copy signature, Show
 * owner; ruling R3) before leaving the list, since that menu shares the row's place in tab order.
 */
export function SelectorList({ facet, catalog, readOnly }: SelectorListProps) {
  const routing = useAnalysis((a) => a.routing);
  const exclude = useDocument((s) => s.project.recipe.exclude);
  const placed = useDocument((s) => s.project.recipe.facets);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const firstRow = useRef<HTMLButtonElement | null>(null);
  useInspectorFocus(readOnly ? null : { kind: "selectors", facet: facet.name }, firstRow);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return facet.selectors
      .filter((s) => needle === "" || s.signature.toLowerCase().includes(needle) || s.hex.toLowerCase().includes(needle))
      .map((selector) => ({
        selector,
        action: pinAction({
          facet: facet.name,
          selector,
          route: routing[selector.hex.toLowerCase() as typeof selector.hex],
          exclude,
          seams: catalog.seams,
          placed,
        }),
      }));
  }, [facet, catalog, routing, exclude, placed, query]);

  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (rows.length === 0) return;
    // Only a pin button's own arrows move between rows: a row's actions menu (its trigger, or an item in its
    // portaled popup, which still bubbles React events through this tree) keeps its own arrow handling.
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-selector")) return;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(current + 1, rows.length - 1);
        break;
      case "ArrowUp":
        next = Math.max(current - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = rows.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActive(next);
    rowRefs.current[next]?.focus();
  };

  return (
    <Section label="Selectors" aside={`${facet.selectors.length}`}>
      <TextField label="Filter selectors" value={query} onValueChange={setQuery} mono />
      {rows.length === 0 ? (
        <p className={sheet.muted}>{query.trim() === "" ? "Exports no selectors." : `No selector matches ‘${query.trim()}’.`}</p>
      ) : (
        <ul className={styles.rows} aria-label={`${facet.name} selectors`} {...(readOnly ? {} : { onKeyDown: move, [KEY_CONTEXT_ATTRIBUTE]: "list" })}>
          {rows.map(({ selector, action }, index) => (
            <SelectorRow
              key={selector.hex}
              selector={selector}
              action={action}
              facet={facet.name}
              readOnly={readOnly}
              tabIndex={index === current ? 0 : -1}
              onFocus={() => setActive(index)}
              rowRef={(element) => {
                rowRefs.current[index] = element;
                if (index === 0) firstRow.current = element;
              }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
