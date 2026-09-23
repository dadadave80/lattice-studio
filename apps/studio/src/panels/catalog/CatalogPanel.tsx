/**
 * The catalog panel (spec L356, IR L76-L100): find and place any facet by name, area, function, selector or
 * namespace, with the keyboard, a double-click or a drag (Flow 3 routes 1-2).
 */
import type { Facet } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { retryCatalog } from "@/catalog";
import {
  announce, chainService, isPlaceholder, runCommand, session, startCatalogDrag, useCatalogStatus, useDocument, useOnline,
  useSession, type ChainInfo, type ChainReadiness,
} from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Checkbox, TextField } from "@/ui/fields";
import { Icon } from "@/ui/icons/Icon";
import { Tree, type TreeItemProps, type TreeNode } from "@/ui/nav";
import { MenuCommandItem, MenuItem, MenuSeparator } from "@/ui/overlays";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
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

/** The chain picker's list (id and display name), synchronous once the chain module loads: no probe needed. */
function useKnownChains(): readonly ChainInfo[] {
  const [chains, setChains] = useState<readonly ChainInfo[]>([]);
  useEffect(() => {
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
  }, []);
  return chains;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

export function CatalogPanel() {
  const status = useCatalogStatus();
  const placedFacets = useDocument((s) => s.project.recipe.facets);
  const online = useOnline();
  const chainId = useSession((s) => s.chainId);
  const readiness = useChainReadiness(chainId);
  const knownChains = useKnownChains();

  const [query, setQuery] = useState("");
  const [manualExpanded, setManualExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [availableOnly, setAvailableOnly] = useState(false);
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

  const onItemClick = (node: TreeNode) => {
    if (isAreaNodeId(node.id)) return;
    if (placedSet.has(node.id)) {
      session.set({ selection: [node.id] });
      if (!isPlaceholder("sheet.locate")) void runCommand({ id: "sheet.locate", args: { facet: node.id } }, "api");
      return;
    }
    void runCommand({ id: "catalog.preview", args: { facet: node.id } }, "button");
  };

  const onActivate = (node: TreeNode) => {
    if (isAreaNodeId(node.id)) return;
    void runCommand({ id: "facet.place", args: { facet: node.id } }, "button");
  };

  const itemProps = (node: TreeNode): TreeItemProps => {
    if (isAreaNodeId(node.id) || placedSet.has(node.id)) return {};
    return {
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
      <FacetRow facet={facet} placed={placedSet.has(node.id)} availability={availability?.get(node.id)} chainName={chainName} />
    );
  };

  const itemMenu = (node: TreeNode) => {
    if (isAreaNodeId(node.id)) return null;
    const facet = facetByName.get(node.id);
    if (!facet || !catalog) return null;
    return (
      <>
        <MenuCommandItem command={{ id: "facet.place", args: { facet: node.id } }} label="Place" />
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

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target === searchInput.current || isTypingTarget(event.target)) return;
    event.preventDefault();
    searchInput.current?.focus();
    searchInput.current?.select();
  };

  return (
    <div className={styles.panel} onKeyDownCapture={onKeyDownCapture}>
      <div className={styles.controls}>
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
          <div aria-hidden="true" className={styles.placeholderRows}>
            {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
              <div key={i} className={styles.placeholderRow} />
            ))}
          </div>
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
          onSelectedChange={setSelected}
          onActivate={onActivate}
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
