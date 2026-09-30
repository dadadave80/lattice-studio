import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import type { CoreStatus } from "@lattice-studio/core";
import { Panel, useStore } from "@xyflow/react";
import { memo, useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";
import { commandRef, KEY_CONTEXT_ATTRIBUTE, runCommand, session, useSession } from "@/contracts";
import { useTitleBlockSize } from "@/sheet/chrome/title-block-size";
import { Toolbar } from "@/ui/nav/Toolbar";
import { ToolbarButton } from "@/ui/nav/ToolbarButton";
import { cx } from "@/ui/shared/cx";
import { CELL_LABEL, COLLAPSE_CELL, CORE, CORE_TAGLINE, CUT, EMPTY_HINT, ERC165, EXPAND_CELL, FALLBACK, LOUPE } from "./copy";
import { RAIL_GAP } from "./geometry";
import { cutName, cutRow, diamondName, erc165Name, fallbackName, fallbackText, loupeName, loupeText } from "./model";
import type { Pads } from "./painter";
import styles from "./core.module.css";

export type Pad = "fallback" | "cut";
/** A pad's tone: ink while a soft trace ends on it, the accent while a live one does. */
export type PadTone = "soft" | "live" | null;

export type CoreCellProps = {
  status: CoreStatus;
  /** The upgrade mechanism's label ("Admin role", "Safe"), for the cut row; undefined without one. */
  mode: string | undefined;
  /** The core is selected: the accent frame. */
  selected: boolean;
  /** Nothing but the core on the sheet: the hint row shows. */
  empty: boolean;
  /** The pad under the pointer or keyboard focus. */
  hot: Pad | null;
  onHot: (pad: Pad | null) => void;
  tones: { fallback: PadTone; cut: PadTone };
  /** Where the pads sit and where the rail runs, relative to the sheet; null while the cell can't be measured. */
  onPads: (pads: Pads | null) => void;
};

/**
 * The core cell isn't a card: it takes the global key context, so the sheet's own keys (Delete, cut, the arrow
 * nudges) never reach the card selection from it. Nothing deletes, cuts or moves the core.
 */
const CORE_KEYS = { [KEY_CONTEXT_ATTRIBUTE]: "global" };
/** The gap between the cell and the title block, in px (a grid step). */
const GAP = 8;
/** The cell's width (`core.module.css` .cell) and the panels' distance from the sheet's edge (space-4). */
const CELL_WIDTH = 290;
const EDGE = 16;
/** Half the width Back to content is allowed before it counts as under the cell (D16). */
const BACK_TO_CONTENT_HALF = 100;
/** How many frames the cell keeps re-measuring after a render for its position to settle. */
const SETTLE_FRAMES = 6;
/** The CSS variable Back to content lifts by while it would sit under the cell (`Sheet.module.css`). */
export const CORE_LIFT_VAR = "--lx-core-lift";

function select(): void {
  void runCommand(commandRef("core.select"), "button");
}

function toggleCollapsed(): void {
  session.set((s) => ({ panes: { ...s.panes, core: { collapsed: !s.panes.core.collapsed } } }));
}

function samePads(a: Pads | null, b: Pads | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.railY === b.railY && a.fallback.x === b.fallback.x && a.fallback.y === b.fallback.y &&
    (a.cut?.x ?? null) === (b.cut?.x ?? null) && (a.cut?.y ?? null) === (b.cut?.y ?? null)
  );
}

/**
 * The core cell (the pinned diamond core, David's brief): a screen-space Panel at the bottom of the sheet,
 * immediately left of the title block, that never pans, fits or tidies away and is there on an empty sheet. Its
 * rows read like a drawing's title block: "CORE The diamond's fixed part", "■ FALLBACK n routed", "LOUPE ■■■■ 4/4
 * ERC-165 ■" and "CUT <variant> · <mode>" (hatched on a conflict), plus the empty sheet's hint. One Tab stop, an
 * APG toolbar: the arrows move between the rows, Home and End go to the ends, each row's name carries its state,
 * and a click, Enter or Space on any of them runs `core.select`. The FALLBACK and CUT pads are where traces end.
 * The chevron folds it to one line (`session.panes.core.collapsed`).
 */
export function CoreCell({ status, mode, selected, empty, hot, onHot, tones, onPads }: CoreCellProps) {
  const root = useStore((s) => s.domNode);
  const sheetWidth = useStore((s) => s.width);
  const title = useTitleBlockSize();
  const collapsed = useSession((s) => s.panes.core.collapsed);
  const cell = useRef<HTMLDivElement>(null);
  const fallbackPad = useRef<HTMLSpanElement>(null);
  const cutPad = useRef<HTMLSpanElement>(null);
  const published = useRef<Pads | null>(null);
  const lift = useRef<string | null>(null);
  const titleWidth = title?.width ?? null;

  // The pads' points and the rail, whenever something can move them: the cell's or the sheet's size (observed),
  // the title block's width (the cell's margin), a fold. And whether Back to content would sit under the cell
  // (D16): then it lifts by the cell's height through a CSS variable on the sheet. Both are written only when
  // they change: the variable is inherited, so writing it restyles the whole sheet.
  useLayoutEffect(() => {
    const el = cell.current;
    if (!root || !el) return undefined;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const top = (pad: HTMLElement | null) => {
        if (!pad) return null;
        const r = pad.getBoundingClientRect();
        return { x: r.left + r.width / 2 - box.left, y: r.top - box.top };
      };
      const own = el.getBoundingClientRect();
      const fallback = top(fallbackPad.current);
      const next = fallback ? { fallback, cut: top(cutPad.current), railY: own.top - box.top - RAIL_GAP } : null;
      if (!samePads(published.current, next)) {
        published.current = next;
        onPads(next);
      }
      const under = own.left - box.left < box.width / 2 + BACK_TO_CONTENT_HALF;
      const want = under ? `${Math.ceil(own.height) + GAP}px` : null;
      if (want === lift.current) return;
      lift.current = want;
      if (want === null) root.style.removeProperty(CORE_LIFT_VAR);
      else root.style.setProperty(CORE_LIFT_VAR, want);
    };
    // A margin set in this commit can take a frame or two to move the panel (Chromium lays the new inline
    // margin out late, and the first frames read the old place): measure again on each of the next few frames.
    measure();
    let frame = 0;
    let left = SETTLE_FRAMES;
    const settle = () => {
      measure();
      frame = --left <= 0 ? 0 : requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    const sizes = new ResizeObserver(() => {
      measure();
    });
    sizes.observe(el);
    sizes.observe(root);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      sizes.disconnect();
    };
  }, [root, onPads, titleWidth, collapsed, empty]);

  useLayoutEffect(
    () => () => {
      root?.style.removeProperty(CORE_LIFT_VAR);
      lift.current = null;
      published.current = null;
      onPads(null);
    },
    [root, onPads],
  );

  // Beside the title block while both fit across the sheet; above it when they don't (the title block's strip
  // form at narrow widths spans the sheet, and a cell pushed past its left edge would sit off-screen).
  const beside = !title || sheetWidth <= 0 || title.width + GAP + CELL_WIDTH + 2 * EDGE <= sheetWidth;
  const style: CSSProperties | undefined = !title
    ? undefined
    : beside
      ? { marginInlineEnd: `calc(var(--lx-space-4) + ${title.width + GAP}px)` }
      : { marginBlockEnd: `calc(var(--lx-space-4) + ${title.height + GAP}px)` };

  // What the pads show (a trace ending on them, the pointer on them) is said on the cell's own element, so a card
  // hovered on the sheet changes one attribute here and never re-renders the toolbar's buttons (`CellRows`).
  return (
    <Panel position="bottom-right" className={styles.panel} style={style} data-chrome="core-cell">
      <div
        ref={cell}
        className={styles.cell}
        data-core-cell=""
        data-selected={selected ? "" : undefined}
        data-collapsed={collapsed ? "" : undefined}
        data-hot={hot ?? undefined}
        data-fallback-tone={tones.fallback ?? undefined}
        data-cut-tone={tones.cut ?? undefined}
        {...CORE_KEYS}
      >
        <CellRows
          status={status}
          mode={mode}
          selected={selected}
          collapsed={collapsed}
          empty={empty}
          onHot={onHot}
          fallbackPad={fallbackPad}
          cutPad={cutPad}
        />
      </div>
    </Panel>
  );
}

type CellRowsProps = {
  status: CoreStatus;
  mode: string | undefined;
  selected: boolean;
  collapsed: boolean;
  empty: boolean;
  onHot: (pad: Pad | null) => void;
  fallbackPad: RefObject<HTMLSpanElement | null>;
  cutPad: RefObject<HTMLSpanElement | null>;
};

/** The cell's rows, an APG toolbar: re-rendered only when what they say changes, never for a pad's tone. */
const CellRows = memo(function CellRows({ status, mode, selected, collapsed, empty, onHot, fallbackPad, cutPad }: CellRowsProps) {
  const cut = cutRow(status, mode);
  const loupe = status.loupe;
  const padProps = (pad: Pad) => ({
    "data-pad-row": pad,
    onPointerEnter: () => onHot(pad),
    onPointerLeave: () => onHot(null),
    onFocus: () => onHot(pad),
    onBlur: () => onHot(null),
  });
  return (
    <Toolbar label={CELL_LABEL} orientation={collapsed ? "horizontal" : "vertical"} className={styles.rows}>
      <div className={cx(styles.line, styles.header)}>
        <BaseToolbar.Button className={styles.row} aria-label={diamondName()} aria-pressed={selected} onClick={select}>
          <span className={styles.key}>{CORE}</span>
          {collapsed ? null : <> <span className={styles.tagline}>{CORE_TAGLINE}</span></>}
        </BaseToolbar.Button>
        {collapsed ? null : (
          <ToolbarButton icon="chevron-down" label={COLLAPSE_CELL} aria-expanded className={styles.chevron} onClick={toggleCollapsed} />
        )}
      </div>
      <div className={styles.line}>
        <BaseToolbar.Button className={styles.row} aria-label={fallbackName(status)} onClick={select} {...padProps("fallback")}>
          <span ref={fallbackPad} className={styles.pad} data-pad="fallback" data-on="" />
          {collapsed ? null : <><span className={styles.key}>{FALLBACK}</span> </>}
          <span className={styles.value}>{fallbackText(status)}</span>
        </BaseToolbar.Button>
      </div>
      <div className={styles.line}>
        <BaseToolbar.Button className={styles.row} aria-label={loupeName(status)} onClick={select}>
          {collapsed ? null : <><span className={styles.key}>{LOUPE}</span> </>}
          <span className={styles.pads}>
            {loupe.selectors.map((selector) => (
              <span key={selector} className={styles.pad} data-on={loupe.covered.includes(selector) ? "" : undefined} />
            ))}
          </span>
          {" "}
          <span className={styles.value}>{loupeText(status)}</span>
        </BaseToolbar.Button>
        <BaseToolbar.Button className={styles.row} aria-label={erc165Name(status)} onClick={select}>
          {collapsed ? null : <span className={styles.key}>{ERC165}</span>}
          <span className={styles.pad} data-on={status.erc165.covered ? "" : undefined} />
        </BaseToolbar.Button>
      </div>
      <div className={styles.line}>
        <BaseToolbar.Button
          className={cx(styles.row, cut.state === "conflict" && styles.conflict)}
          aria-label={cutName(status, mode)}
          data-cut={cut.state}
          onClick={select}
          {...padProps("cut")}
        >
          <span className={styles.key}>{CUT}</span>
          {collapsed ? null : <> <span className={cx(styles.value, cut.state === "empty" && styles.empty)}>{cut.text}</span></>}
          <span ref={cutPad} className={styles.pad} data-pad="cut" data-on={cut.state === "empty" ? undefined : ""} />
        </BaseToolbar.Button>
        {collapsed ? (
          <ToolbarButton icon="chevron-up" label={EXPAND_CELL} aria-expanded={false} className={styles.chevron} onClick={toggleCollapsed} />
        ) : null}
      </div>
      {empty && !collapsed ? <p className={styles.hint}>{EMPTY_HINT}</p> : null}
    </Toolbar>
  );
});
