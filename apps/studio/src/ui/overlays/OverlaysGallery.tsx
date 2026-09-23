import { useState } from "react";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { GallerySection, Specimen } from "../gallery/GallerySection";
import { ContextMenu } from "./ContextMenu";
import { Dialog, type DialogSize } from "./Dialog";
import { Menu } from "./Menu";
import { MenuCheckboxItem } from "./MenuCheckboxItem";
import { MenuGroup } from "./MenuGroup";
import { MenuItem } from "./MenuItem";
import { MenuRadioGroup } from "./MenuRadioGroup";
import { MenuRadioItem } from "./MenuRadioItem";
import { MenuSeparator } from "./MenuSeparator";
import styles from "./OverlaysGallery.module.css";
import { Popover } from "./Popover";
import { Submenu } from "./Submenu";
import { createToasts } from "./toasts";
import { ToastRegion } from "./ToastRegion";

type GalleryDialog = { size: DialogSize; lossless: boolean; title: string };

const DIALOGS = {
  medium: { size: "medium", lossless: false, title: "Save a copy" },
  wide: { size: "wide", lossless: false, title: "Deploy review" },
  lossless: { size: "medium", lossless: true, title: "Keyboard shortcuts" },
} satisfies Record<string, GalleryDialog>;

const noop = () => {};

/** The overlays in the `#/__ui` gallery: every trigger, nothing open until pressed. */
export function OverlaysGallery() {
  const [minimap, setMinimap] = useState(true);
  const [theme, setTheme] = useState("shop");
  const [dialog, setDialog] = useState<GalleryDialog | null>(null);
  const [toasts] = useState(createToasts);
  const close = () => setDialog(null);

  return (
    <GallerySection title="Overlays">
      <Specimen label="Menu">
        <Menu trigger={<Button>Export</Button>} label="Export">
          <MenuItem label="Foundry script" onSelect={noop} shortcut="Mod+e" icon="export" />
          <MenuItem label="Agent brief" onSelect={noop} />
          <MenuItem label="Safe batch" onSelect={noop} disabledReason="Choose a Safe first" />
          <MenuSeparator />
          <MenuItem label="Copy link" onSelect={noop} shortcut="Mod+Shift+c" icon="link" />
        </Menu>
        <Menu trigger={<IconButton icon="menu" label="App menu" />} label="App menu">
          <MenuGroup label="Sheet">
            <MenuCheckboxItem label="Minimap" checked={minimap} onCheckedChange={setMinimap} />
          </MenuGroup>
          <MenuSeparator />
          <MenuRadioGroup label="Theme" value={theme} onValueChange={setTheme}>
            <MenuRadioItem value="shop" label="Shop" />
            <MenuRadioItem value="draft" label="Draft" />
          </MenuRadioGroup>
          <MenuSeparator />
          <Submenu label="Recent projects">
            <MenuItem label="GovernedVault" onSelect={noop} />
            <MenuItem label="Shop sample" onSelect={noop} />
          </Submenu>
          <MenuItem label="Settings" onSelect={noop} shortcut="Mod+," icon="settings" />
        </Menu>
      </Specimen>

      <Specimen label="Context menu (right click, Shift+F10 or the Menu key)">
        <ContextMenu
          label="ERC20 actions"
          items={
            <>
              <MenuItem label="Open in inspector" onSelect={noop} />
              <MenuItem label="Locate" onSelect={noop} />
              <MenuItem label="Move to…" onSelect={noop} shortcut="m" />
              <MenuItem label="Flip pins" onSelect={noop} disabledReason="No pins to flip" />
              <MenuSeparator />
              <MenuItem label="Remove" onSelect={noop} shortcut="Delete" />
            </>
          }
        >
          {/* A stand-in facet card: a focusable group, as the sheet draws them (spec L745). */}
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-tabindex */}
          <div className={styles.target} role="group" aria-roledescription="facet card" aria-label="ERC20, 9 selectors" tabIndex={0}>
            <span className={styles.targetTitle}>ERC20</span>
            <span className={styles.targetMeta}>9 selectors</span>
          </div>
        </ContextMenu>
      </Specimen>

      <Specimen label="Popover">
        <Popover trigger={<Button>Salt</Button>} title="Salt" description="The CREATE2 salt for this deploy." closeButton>
          <Button size="small">Use a new salt</Button>
        </Popover>
      </Specimen>

      <Specimen label="Dialog: medium, wide, lossless">
        <Button onClick={() => setDialog(DIALOGS.medium)}>Save a copy…</Button>
        <Button onClick={() => setDialog(DIALOGS.wide)}>Deploy…</Button>
        <Button onClick={() => setDialog(DIALOGS.lossless)}>Keyboard shortcuts</Button>
        <Dialog
          open={dialog !== null}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={dialog?.title ?? ""}
          description={dialog?.lossless ? "A click on the scrim closes this one." : "Esc or Cancel closes it; the scrim doesn't."}
          size={dialog?.size ?? "medium"}
          lossless={dialog?.lossless ?? false}
          footer={
            dialog?.lossless ? (
              <Button onClick={close}>Close</Button>
            ) : (
              <>
                <Button onClick={close}>Cancel</Button>
                <Button variant="primary" onClick={close}>
                  Save
                </Button>
              </>
            )
          }
        >
          <p>Dialogs trap Tab, close on Esc and return focus to the control that opened them.</p>
        </Dialog>
      </Specimen>

      <Specimen label="Toast">
        <Button onClick={() => toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } })}>Show toast</Button>
        <Button onClick={() => toasts.add({ text: "Couldn't write GovernedVault.lattice.json: the disk is full.", kind: "error" })}>
          Show error toast
        </Button>
        <ToastRegion manager={toasts.manager} />
      </Specimen>
    </GallerySection>
  );
}
