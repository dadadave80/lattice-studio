import "@xyflow/react/dist/base.css";
import { ReactFlow, ReactFlowProvider, type NodeChange, type OnMove } from "@xyflow/react";
import { lazy, Suspense, useMemo, useRef, useState, type FocusEvent, type RefObject } from "react";
import {
  KEY_CONTEXT_ATTRIBUTE, sheetEdgeTypes, sheetLayers, sheetNodeTypes, useDocument, useSession, useSettings,
  useSheetInteractions,
} from "@/contracts";
import { BackToContent } from "./BackToContent";
import { nodeBuilder, tabStopOf, type Measured } from "./nodes";
import { cardInView, ensureElementVisible, ensureVisible } from "./sheet-view";
import { SheetGrid } from "./SheetGrid";
import { useSpacePan } from "./use-space-pan";
import { useViewportSync } from "./use-viewport-sync";
import { MAX_ZOOM, MIN_ZOOM } from "./viewport-math";
import styles from "./Sheet.module.css";

/**
 * React Flow's node and edge types, read once at module scope from the sheet seam (contracts `sheet.ts`), so
 * they never change identity between renders (spec L825). S4a and S4c register into them.
 */
export const nodeTypes = sheetNodeTypes();
export const edgeTypes = sheetEdgeTypes();

/** The minimap is off by default (PA L67), so it's its own chunk. */
const Minimap = lazy(() => import("./Minimap").then((m) => ({ default: m.Minimap })));

/** With the Select tool, a left drag belongs to cards and the marquee: middle and right drags pan (IR L52). */
const PAN_BUTTONS_SELECT = [1, 2];
const PRO_OPTIONS = { hideAttribution: true };
const KEY_CONTEXT = { [KEY_CONTEXT_ATTRIBUTE]: "sheet" };

/**
 * When a card takes keyboard focus (Tab, undo's restored card, F8, S4e's arrows), or any focus while it's
 * entirely off-screen, pan it clear of the floating UI first (spec L755, L771); a pin row focused inside a
 * card is kept clear on its own, so moving through a tall card's rows never jumps back to its header. A pointer
 * press on a visible card never moves the view under the pointer.
 */
function followFocus(event: FocusEvent<HTMLDivElement>): void {
  const target = event.target;
  const card = target.closest<HTMLElement>(".react-flow__node[data-id]");
  const facet = card?.dataset.id;
  if (!card || !facet) return;
  if (!target.matches(":focus-visible") && cardInView(facet)) return;
  if (target === card) ensureVisible(facet);
  else ensureElementVisible(target);
}

/**
 * The sheet (spec L357, L744, L752; Flow 8): React Flow with only `base.css` and its keyboard layer off, the
 * cards from the project's layout, the viewport the project keeps, every pan and zoom path, an 8 px dot grid,
 * Back to content and the minimap. It renders the layers other modules register (`sheetLayers()`) inside
 * `<ReactFlow>` and spreads S4e's `useSheetInteractions()` under its own props. `sheet-view.ts` is how
 * everything else moves the view.
 */
export function Sheet() {
  const wrapper = useRef<HTMLDivElement>(null);
  const tool = useSession((s) => s.tool);
  const space = useSpacePan(wrapper);
  return (
    <div
      ref={wrapper}
      className={styles.sheet}
      data-tool={tool}
      data-panning={space ? "" : undefined}
      onFocus={followFocus}
      {...KEY_CONTEXT}
    >
      <ReactFlowProvider>
        <SheetFlow wrapper={wrapper} hand={tool === "hand" || space} />
      </ReactFlowProvider>
    </div>
  );
}

function sameMeasured(a: Measured | undefined, b: Measured): boolean {
  return a !== undefined && a.width === b.width && a.height === b.height;
}

type SheetFlowProps = { wrapper: RefObject<HTMLDivElement | null>; hand: boolean };

function SheetFlow({ wrapper, hand }: SheetFlowProps) {
  const interactions = useSheetInteractions();
  const layout = useDocument((s) => s.project.layout);
  const selection = useSession((s) => s.selection);
  const focus = useSession((s) => s.focus);
  const wheel = useSettings((s) => s.wheel);
  const minimap = useSettings((s) => s.minimap);
  const [measured, setMeasured] = useState<ReadonlyMap<string, Measured>>(() => new Map());
  const [build] = useState(() => nodeBuilder());
  const { initial, restoring, onMoveEnd } = useViewportSync(wrapper);

  const tabStop = tabStopOf(layout, focus, selection);
  const nodes = useMemo(() => build({ layout, selection, tabStop, measured }), [build, layout, selection, tabStop, measured]);

  const theirNodesChange = interactions.onNodesChange;
  const onNodesChange = (changes: NodeChange[]) => {
    // Keep what React Flow measured on the node, so a node rebuilt for a move keeps its handles (spec L825).
    const sizes = changes.flatMap((c) => (c.type === "dimensions" && c.dimensions ? [{ id: c.id, size: c.dimensions }] : []));
    if (sizes.length) {
      setMeasured((previous) => {
        if (sizes.every(({ id, size }) => sameMeasured(previous.get(id), size))) return previous;
        const next = new Map(previous);
        for (const { id, size } of sizes) next.set(id, { width: size.width, height: size.height });
        return next;
      });
    }
    theirNodesChange?.(changes);
  };

  const theirMoveEnd = interactions.onMoveEnd;
  const moveEnd: OnMove = (event, viewport) => {
    onMoveEnd(event, viewport);
    theirMoveEnd?.(event, viewport);
  };

  const panOnScroll = wheel === "pan";
  return (
    <ReactFlow
      {...interactions}
      nodes={nodes}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onMoveEnd={moveEnd}
      {...(initial ? { defaultViewport: initial } : {})}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      disableKeyboardA11y
      deleteKeyCode={null}
      zoomOnDoubleClick={false}
      onlyRenderVisibleElements={false}
      panActivationKeyCode={null}
      panOnScroll={panOnScroll}
      zoomOnScroll={!panOnScroll}
      zoomOnPinch
      panOnDrag={hand ? true : PAN_BUTTONS_SELECT}
      {...(hand ? { nodesDraggable: false, selectionOnDrag: false } : {})}
      nodesConnectable={false}
      edgesFocusable={false}
      edgesReconnectable={false}
      proOptions={PRO_OPTIONS}
      aria-label="Diamond sheet"
      className={restoring ? styles.restoring : undefined}
    >
      <BackToContent />
      {sheetLayers().map(({ id, Component }) => (
        <Component key={id} />
      ))}
      <SheetGrid />
      {minimap ? (
        <Suspense fallback={null}>
          <Minimap />
        </Suspense>
      ) : null}
    </ReactFlow>
  );
}
