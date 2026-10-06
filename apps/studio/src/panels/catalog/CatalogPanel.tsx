/**
 * The catalog panel (spec L356, IR L76-L100): find and place any facet by name, area, function, selector or
 * namespace, with the keyboard, a double-click or a drag (Flow 3 routes 1-2).
 */
import type { Facet } from "@lattice-studio/core";
import { isCoreFacet, plural } from "@lattice-studio/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { hasCachedIndex, retryCatalog } from "@/catalog";
import {
  announce, chainService, commandRef, isPlaceholder, log, runCommand, session, startCatalogDrag, useCatalogStatus,
  useDocument, useOnline, useSession, type ChainInfo, type ChainReadiness,
} from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Checkbox } from "@/ui/fields/Checkbox";
import { TextField } from "@/ui/fields/TextField";
import { Icon } from "@/ui/icons/Icon";
import { Tree, type TreeItemProps } from "@/ui/nav/Tree";
import type { TreeNode } from "@/ui/nav/tree-model";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { CORE_FACET_REASON } from "../core-copy";
import { AreaRow, FacetRow } from "./CatalogRow";
import { areaOfNodeId, buildCatalogNodes, chainAvailability, isAreaNodeId, placedCountByArea } from "./catalog-tree";
import { registerSearchFocus } from "./search-focus";
import styles from "./CatalogPanel.module.css";

/** Lattice at the pinned commit (contracts §4 `catalog.lattice.commit`), for "Open source on GitHub". */
const LATTICE_REPO = "https://github.com/dadadave80/lattice";

const PLACEHOLDER_ROWS = 6;

/**
 * S8a's `CHOOSE_A_CHAIN` (`chain/infra/copy.ts`), one label everywhere (spec L674). Kept as a literal: that
 * module is behind the lazy chain boundary (contracts §5.2 `chainService`), and this panel isn't.
 */
const CHOOSE_A_CHAIN = "Choose a chain first.";

function githubUrl(commit: string, facet: Facet): string {
  return `${LATTICE_REPO}/blob/${commit}/${facet.source}`;
}

/** Says why a key or a double-click on a core facet's row placed nothing: in the console and the status region. */
function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

/**
 * Reads a chain's last-known readiness without ever probing it: probing is S8a's job, not the catalog's.
 * Keeps the readiness alongside the chain id it belongs to, so a chain change reads as unknown at render
 * time (not through an extra synchronous `setState` in the effect) until the new one resolves.
 */
function useChainReadiness(chainId: number | null): ChainReadiness | null {
  const [entry, setEntry] = useState<{ chainId: number; readiness: ChainReadiness } | null>(null);
  useEffect(() => {
    if (chainId === null) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    chainService()
      .then((service) => {
        if (cancelled) return;
        setEntry({ chainId, readiness: service.readiness(chainId) });
        unsubscribe = service.subscribeReadiness((changed) => {
          if (changed === chainId) setEntry({ chainId, readiness: service.readiness(chainId) });
        });
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [chainId]);
  return entry && entry.chainId === chainId ? entry.readiness : null;
}

/**
 * The chain picker's list (id and display name), synchronous once the chain module loads: no probe needed.
 * Touches `chainService()` only once a chain is selected: the catalog is on screen at first paint, and the
 * chain module (wagmi, viem clients, probes) loads only when a chain is chosen or a deploy starts (spec
 * D13 L25; S8a's brief). With nothing selected there's nothing to name, so nothing loads.
 */
function useKnownChains(chainId: number | null): readonly ChainInfo[] {
  const [chains, setChains] = useState<readonly ChainInfo[]>([]);
  useEffect(() => {
    if (chainId === null) return undefined;
    let cancelled = false;
    chainService()
      .then((service) => {
        if (!cancelled) setChains(service.chains());
      })
      .catch(() => {
        // Not built yet, or the chunk failed to load: no chains to name.
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);
  return chains;
}

export function CatalogPanel() {
  const status = useCatalogStatus();
  const placedFacets = useDocument((s) => s.project.recipe.facets);
  const online = useOnline();
  const chainId = useSession((s) => s.chainId);
  const readiness = useChainReadiness(chainId);
  const knownChains = useKnownChains(chainId);
  const selection = useSession((s) => s.selection);

  const [query, setQuery] = useState("");
  const [manualExpanded, setManualExpanded] = useState<string[]>([]);
  /**
   * A row selected here that the sheet's selection can't hold (an unplaced facet being previewed, or an
   * area), and the sheet selection it was made over: it stands only until the sheet's selection changes.
   */
  const [local, setLocal] = useState<{ id: string; over: readonly string[] } | null>(null);
  const [availableOnly, setAvailableOnly] = useState(false);
  // Static placeholder rows on a first visit only (spec L695); later visits read the index from the service
  // worker's cache (spec L399), where placeholders would only flash.
  const [firstVisit] = useState(() => !hasCachedIndex());
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registerSearchFocus(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
    return () => registerSearchFocus(null);
  }, []);

  const catalog = status.status === "ready" ? status.catalog : null;
  const placedSet = useMemo(() => new Set(placedFacets), [placedFacets]);
  // One facet selected on the sheet highlights its catalog row (spec L380); the catalog follows the sheet.
  const sheetSelected = useMemo(() => selection.filter((name) => placedSet.has(name)), [selection, placedSet]);
  const selected = local && local.over === selection ? [local.id] : sheetSelected;
  const facetByName = useMemo(() => new Map(catalog?.facets.map((f) => [f.name, f]) ?? []), [catalog]);
  const placedCounts = useMemo(
    () => (catalog ? placedCountByArea(catalog, placedSet) : new Map<string, number>()),
    [catalog, placedSet],
  );
  const availability = useMemo(() => (catalog ? chainAvailability(catalog, readiness) : null), [catalog, readiness]);
  // The picker names a chain synchronously; the probed state (once ready) is the same name, just confirmed.
  const chainName =
    readiness?.status === "ready" ? readiness.state.name : (knownChains.find((c) => c.id === chainId)?.name ?? null);

  const filterReason = !online
    ? "Chain checks need a connection."
    : chainId === null
      ? CHOOSE_A_CHAIN
      : readiness?.status === "error"
        ? readiness.reason
        : availability === null
          ? `Checking ${chainName ?? "chain"}…`
          : undefined;

  const { nodes, matchCount, matchedAreaIds } = useMemo(() => {
    if (!catalog) return { nodes: [] as TreeNode[], matchCount: 0, matchedAreaIds: [] as string[] };
    const include =
      availableOnly && availability
        ? (facet: Facet) => availability.get(facet.name)?.available === true
        : undefined;
    return buildCatalogNodes(catalog, query, include);
  }, [catalog, query, availableOnly, availability]);

  const searching = query.trim().length > 0;
  const expanded = searching ? matchedAreaIds : manualExpanded;
  const onExpandedChange = (next: string[]) => {
    if (!searching) setManualExpanded(next);
  };

  useEffect(() => {
    if (!searching || !catalog) return;
    announce(`${plural(matchCount, "match", "matches")}.`, { politeness: "polite", merge: "catalog-search" });
    // Only the query (and what it matches against) should re-announce, not every catalog identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCount]);

  /** A placed facet selected here selects its card, as the Structure tree does; anything else stays local. */
  const onSelectedChange = (next: string[]) => {
    const id = next.at(-1);
    // A core facet's row is disabled, so the tree never selects it; it's never a card either way.
    if (id !== undefined && isCoreFacet(id)) return;
    if (id !== undefined && placedSet.has(id)) {
      setLocal(null);
      const current = session.get().selection;
      if (!(current.length === 1 && current[0] === id)) session.set({ selection: [id] });
      return;
    }
    setLocal(id === undefined ? null : { id, over: selection });
  };

  const onItemClick = (node: TreeNode) => {
    if (isAreaNodeId(node.id)) return;
    // A core facet's row: a click selects the core (the row itself is disabled, so it never places or selects).
    if (isCoreFacet(node.id)) {
      void runCommand(commandRef("core.select"), "button");
      return;
    }
    if (placedSet.has(node.id)) {
      session.set({ selection: [node.id] });
      if (!isPlaceholder("sheet.locate")) void runCommand({ id: "sheet.locate", args: { facet: node.id } }, "api");
      return;
    }
    void runCommand({ id: "catalog.preview", args: { facet: node.id } }, "button");
  };

  const onActivate = (node: TreeNode) => {
    if (isAreaNodeId(node.id) || isCoreFacet(node.id)) return;
    void runCommand({ id: "facet.place", args: { facet: node.id } }, "button");
  };

  // The tree never activates a disabled row, so Enter on a core facet's row does what a click does: it selects the
  // core (whose readout names it), rather than placing nothing in silence.
  const onItemKeyDown = (event: KeyboardEvent<HTMLElement>, node: TreeNode) => {
    if (event.key !== "Enter" || !isCoreFacet(node.id) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void runCommand(commandRef("core.select"), "keys");
  };

  const itemProps = (node: TreeNode): TreeItemProps => {
    if (isAreaNodeId(node.id)) return {};
    // No drag either: the tree ignores a double-click on a disabled row, so the row says why itself.
    if (isCoreFacet(node.id)) return { onDoubleClick: () => say(CORE_FACET_REASON) };
    if (placedSet.has(node.id)) return {};
    return {
      // Vertical swipes still scroll the list; a sideways touch drag reaches the sheet (spec L417).
      className: styles.draggable,
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        startCatalogDrag(node.id, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY });
      },
    };
  };

  const renderItem = (node: TreeNode) => {
    if (isAreaNodeId(node.id)) {
      const area = areaOfNodeId(node.id);
      return <AreaRow label={node.label} onSheet={placedCounts.get(area) ?? 0} />;
    }
    const facet = facetByName.get(node.id);
    if (!facet) return node.label;
    return (
      <FacetRow
        facet={facet}
        placed={placedSet.has(node.id)}
        core={isCoreFacet(node.id)}
        availability={availability?.get(node.id)}
        chainName={chainName}
      />
    );
  };

  const itemMenu = (node: TreeNode) => {
    if (isAreaNodeId(node.id)) return null;
    const facet = facetByName.get(node.id);
    if (!facet || !catalog) return null;
    return (
      <>
        {isCoreFacet(node.id) ? (
          <>
            <MenuItem label="Place" onSelect={() => undefined} disabledReason={CORE_FACET_REASON} />
            <MenuCommandItem command={commandRef("core.select")} />
          </>
        ) : (
          <MenuCommandItem command={{ id: "facet.place", args: { facet: node.id } }} label="Place" />
        )}
        <MenuCommandItem command={{ id: "catalog.preview", args: { facet: node.id } }} label="Preview" />
        <MenuSeparator />
        <MenuItem
          label="Open source on GitHub"
          onSelect={() => {
            window.open(githubUrl(catalog.lattice.commit, facet), "_blank", "noopener,noreferrer");
          }}
        />
      </>
    );
  };

  return (
    <div className={styles.panel}>
      {/* The tour's first coach mark (spec L400) lands just below the search, beside the catalog's rows. */}
      <div className={styles.controls} data-tour="catalog">
        <TextField
          label="Search"
          value={query}
          onValueChange={setQuery}
          placeholder="Name, area, selector…"
          inputRef={searchInput}
          className={styles.search}
        />
        <Checkbox
          label={chainName ? `Available on ${chainName}` : "Available on chain"}
          checked={availableOnly}
          onCheckedChange={setAvailableOnly}
          disabledReason={filterReason}
        />
      </div>
      {status.status === "loading" ? (
        <div className={styles.state}>
          <VisuallyHidden aria-live="polite">Loading the catalog…</VisuallyHidden>
          {firstVisit ? (
            <div aria-hidden="true" className={styles.placeholderRows} data-placeholder-rows="">
              {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
                <div key={i} className={styles.placeholderRow} />
              ))}
            </div>
          ) : null}
        </div>
      ) : status.status === "error" ? (
        <div className={styles.state}>
          <p className={styles.errorText}>
            <Icon name="error" size="small" />
            {`Couldn't load the catalog. ${status.reason}`}
          </p>
          <Button onClick={() => void retryCatalog()}>Retry</Button>
        </div>
      ) : searching && matchCount === 0 ? (
        <p className={styles.state}>
          {`No facet matches ‘${query.trim()}’. Search covers names, areas, function names, selectors (0x…) and namespaces.`}
        </p>
      ) : (
        <Tree
          label="Catalog"
          className={styles.tree}
          nodes={nodes}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          selected={selected}
          onSelectedChange={onSelectedChange}
          onActivate={onActivate}
          onItemKeyDown={onItemKeyDown}
          onItemClick={onItemClick}
          itemProps={itemProps}
          itemMenu={itemMenu}
          renderItem={renderItem}
          rowHeight={44}
        />
      )}
    </div>
  );
}
