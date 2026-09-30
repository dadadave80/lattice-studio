import type { Catalog, CommandRef, InitPlan, Recipe } from "@lattice-studio/core";
import { isCoreOnly, isNotImplemented, planInit } from "@lattice-studio/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { commandState, runCommand, session, useAnalysis, useCatalog, useDocument, useSession } from "@/contracts";
import { isContextMenuKey, Tree, type TreeItemProps, type TreeNode } from "@/ui";
import { activate, facetsToRemove, locate, moveStep, pressSpace, say, selectForMenu } from "./actions";
import { FacetMenu } from "./FacetMenu";
import { ProblemMenu } from "./ProblemMenu";
import { SelectorMenu } from "./SelectorMenu";
import {
  buildStructure, facetId, facetOfId, focusAfterRemove, INIT_ID, PROBLEMS_ID, type StructureMeta,
} from "./structure-model";
import { StructureItem } from "./StructureItem";
import styles from "./StructurePanel.module.css";

/** C4a's plan; null while the catalog loads or while planInit is a stub. */
function initPlan(recipe: Recipe, catalog: Catalog | null): InitPlan | null {
  if (!catalog) return null;
  try {
    return planInit(recipe, catalog);
  } catch (error) {
    if (isNotImplemented(error)) return null;
    throw error;
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

const DEFAULT_EXPANDED = [PROBLEMS_ID, INIT_ID];

/**
 * The Structure tab (spec L747, IR L90-L97): the sheet's accessible twin, as an APG tree of the placed facets
 * and their selectors, the problems and the init plan. Selection is the session's, so it syncs both ways with
 * the sheet; every action runs a command, so what can't run says why.
 */
export function StructurePanel() {
  const recipe = useDocument((s) => s.project.recipe);
  const catalog = useCatalog();
  const analysis = useAnalysis();
  const selection = useSession((s) => s.selection);
  const plan = useMemo(() => initPlan(recipe, catalog), [recipe, catalog]);
  const structure = useMemo(() => buildStructure({ recipe, catalog, analysis, plan }), [recipe, catalog, analysis, plan]);
  const selected = useMemo(() => selection.map(facetId), [selection]);
  const [expanded, setExpanded] = useState<string[]>(DEFAULT_EXPANDED);
  const [focused, setFocused] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  /** The facet a plain click just located, so the selection change it makes doesn't locate it again. */
  const clicked = useRef<string | null>(null);
  const idBase = useId();
  const describedBy = useCallback((facet: string) => `${idBase}-${facet}-description`, [idBase]);

  // Selected on the sheet: the facet takes the tree's Tab stop, unless someone is working in the tree.
  useEffect(() => {
    const last = selection.at(-1);
    if (last === undefined) return;
    if (container.current?.contains(document.activeElement)) return;
    setFocused(facetId(last));
  }, [selection]);

  const onSelectedChange = (next: string[]) => {
    const facets = next.flatMap((id) => {
      const facet = facetOfId(id);
      return facet === null ? [] : [facet];
    });
    // Only facets are selectable (the session's selection is facet names): selecting just a selector, a
    // problem or a step leaves the selection as it was.
    if (facets.length === 0 && next.length > 0) return;
    const current = session.get().selection;
    if (sameList(facets, current)) return;
    session.set({ selection: facets });
    const [only] = facets;
    if (facets.length === 1 && only !== undefined && clicked.current !== only) locate(only);
  };

  const toggle = (id: string) => {
    setExpanded((open) => (open.includes(id) ? open.filter((other) => other !== id) : [...open, id]));
  };

  const onActivate = (node: TreeNode) => {
    const meta = structure.meta.get(node.id);
    if (!meta || activate(meta, "keys")) return;
    // The Problems branch: Enter opens or closes it.
    if (node.children?.length) toggle(node.id);
    else say("No problems.");
  };

  const onItemClick = (node: TreeNode, event: MouseEvent<HTMLElement>) => {
    const facet = facetOfId(node.id);
    if (facet === null || event.shiftKey || event.ctrlKey || event.metaKey) return;
    // Clicking a placed facet selects it and centers it (spec L483).
    clicked.current = facet;
    queueMicrotask(() => {
      clicked.current = null;
    });
    locate(facet);
  };

  const remove = (meta: StructureMeta) => {
    const facets = facetsToRemove(meta, session.get().selection);
    const ref: CommandRef = { id: "facet.remove", args: { facets } };
    const own = meta.kind === "facet" || meta.kind === "selector" ? meta.facet : null;
    // The focused row is leaving: focus goes to the next facet, else the previous one (spec L755).
    if (own !== null && facets.includes(own) && commandState(ref, "keys").ok) {
      const next = focusAfterRemove(structure.facets, new Set(facets.map(facetId)), facetId(own));
      if (next !== null) setFocused(next);
    }
    void runCommand(ref, "keys");
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLElement>, node: TreeNode) => {
    const meta = structure.meta.get(node.id);
    if (!meta) return;
    const mods = event.ctrlKey || event.metaKey || event.shiftKey;
    if (event.altKey && !mods && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (moveStep(meta, recipe, event.key === "ArrowUp" ? -1 : 1)) event.preventDefault();
      return;
    }
    if (mods || event.altKey) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(meta);
      return;
    }
    if (event.key === " ") {
      if (pressSpace(meta)) event.preventDefault();
      else if (meta.kind === "problems") {
        event.preventDefault();
        onActivate(node);
      }
    }
  };

  const itemProps = (node: TreeNode): TreeItemProps => {
    const meta = structure.meta.get(node.id);
    if (!meta) return {};
    const props: TreeItemProps = { "data-kind": meta.kind };
    switch (meta.kind) {
      case "facet":
        props["aria-label"] = meta.label;
        if (meta.description) props["aria-describedby"] = describedBy(meta.facet);
        props.onContextMenu = () => selectForMenu(meta.facet);
        props.onKeyDown = (event) => {
          if (isContextMenuKey(event)) selectForMenu(meta.facet);
        };
        break;
      case "selector":
        props["aria-label"] = meta.view.label;
        props["data-state"] = meta.view.state;
        break;
      default:
        props["aria-label"] = meta.label;
    }
    return props;
  };

  const itemMenu = (node: TreeNode) => {
    const meta = structure.meta.get(node.id);
    switch (meta?.kind) {
      case "facet": {
        const contested = catalog?.facets
          .find((f) => f.name === meta.facet)
          ?.selectors.some(({ hex }) => {
            const route = analysis.routing[hex];
            return route !== undefined && route.contenders.length >= 2 && route.owner !== meta.facet && route.via !== "seam";
          }) ?? false;
        return <FacetMenu facet={meta.facet} contested={contested} />;
      }
      case "selector":
        return <SelectorMenu facet={meta.facet} view={meta.view} />;
      case "problem": {
        const { problem } = meta;
        const hasCard = problem.where.some((a) => (a.kind === "facet" || a.kind === "selector") && a.facet !== undefined);
        return problem.fixes.length > 0 || hasCard ? <ProblemMenu problem={problem} /> : null;
      }
      default:
        return null;
    }
  };

  const itemMenuLabel = (node: TreeNode) => {
    const meta = structure.meta.get(node.id);
    if (meta?.kind === "selector") return `${meta.view.signature} actions`;
    if (meta?.kind === "problem") return `${meta.problem.code} actions`;
    return `${node.label} actions`;
  };

  return (
    <div ref={container} className={styles.panel}>
      {isCoreOnly(recipe) ? <p className={styles.empty}>No facets yet</p> : null}
      <Tree
        label="Structure"
        className={styles.tree}
        nodes={structure.nodes}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selected={selected}
        onSelectedChange={onSelectedChange}
        multiSelect
        focusedId={focused}
        onFocusedChange={setFocused}
        onActivate={onActivate}
        onItemKeyDown={onItemKeyDown}
        onItemClick={onItemClick}
        itemProps={itemProps}
        itemMenu={itemMenu}
        itemMenuLabel={itemMenuLabel}
        renderItem={(node) => {
          const meta = structure.meta.get(node.id);
          if (!meta) return node.label;
          return <StructureItem meta={meta} descriptionId={meta.kind === "facet" ? describedBy(meta.facet) : undefined} />;
        }}
      />
    </div>
  );
}
