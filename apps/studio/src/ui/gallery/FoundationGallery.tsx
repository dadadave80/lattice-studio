import { useState } from "react";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { copyText } from "../copy/copy-text";
import { Icon } from "../icons/Icon";
import { ICON_NAMES } from "../icons/icon-paths";
import { Kbd } from "../keys/Kbd";
import { ShortcutChip } from "../keys/ShortcutChip";
import { Banner } from "../status/Banner";
import { HATCH_FILL, hatchedClass } from "../status/hatch";
import { HatchPattern } from "../status/HatchPattern";
import { StatusChip } from "../status/StatusChip";
import { VisuallyHidden } from "../shared/VisuallyHidden";
import styles from "./Gallery.module.css";
import { GallerySection, Specimen } from "./GallerySection";

const ADDRESS = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

/** Buttons, keys, status, icons, hatching and Copy, in every state. */
export function FoundationGallery() {
  const [presses, setPresses] = useState(0);
  return (
    <>
      <GallerySection title="Buttons">
        <Specimen label="Primary, one per view">
          <Button variant="primary" onClick={() => setPresses((n) => n + 1)}>
            Deploy…
          </Button>
          <Button variant="primary" disabledReason="Resolve 2 blockers · F8">
            Deploy…
          </Button>
        </Specimen>
        <Specimen label="Secondary">
          <Button onClick={() => setPresses((n) => n + 1)}>Use a new salt</Button>
          <Button icon="download">Download batch</Button>
          <Button disabledReason="Connect a wallet first">Retry reading Sepolia</Button>
          <Button size="small">Retry</Button>
        </Specimen>
        <Specimen label="Quiet">
          <Button variant="quiet">Cancel</Button>
          <Button variant="quiet" disabledReason="Nothing to undo">
            Undo
          </Button>
          <Button variant="quiet" size="small">
            Close
          </Button>
        </Specimen>
        <Specimen label="Icon buttons">
          <IconButton icon="undo" label="Undo" shortcut="Mod+z" />
          <IconButton icon="redo" label="Redo" shortcut={[{ keys: "Ctrl+y", platform: "other" }, "Mod+Shift+z"]} />
          <IconButton icon="zoom-in" label="Zoom in" shortcut="=" />
          <IconButton icon="fit" label="Fit" shortcut="Shift+[Digit1]" disabledReason="Place facets first" />
          <IconButton icon="close" label="Close" size="small" />
        </Specimen>
        <p aria-live="polite" className={styles.specimenLabel}>
          {`Pressed ${presses} ${presses === 1 ? "time" : "times"}`}
        </p>
      </GallerySection>

      <GallerySection title="Keys">
        <Specimen label="Kbd, per platform">
          <Kbd keys="Mod+k" />
          <Kbd keys="Mod+Shift+z" />
          <Kbd keys="Shift+[Digit1]" />
          <Kbd keys="F6" />
        </Specimen>
        <Specimen label="Shortcut chips">
          <ShortcutChip keys="Mod+k" />
          <ShortcutChip keys="Mod+Enter" />
          <ShortcutChip binding="palette.open" />
        </Specimen>
      </GallerySection>

      <GallerySection title="Status">
        <Specimen label="Status chip">
          <StatusChip tone="idle" text="Not deployed" />
          <StatusChip tone="pending" text="Proposed · Sepolia (Safe)" />
          <StatusChip tone="live" text="Live · Sepolia · r1" />
          <StatusChip tone="attention" text="Modified since r1" />
          <StatusChip tone="attention" text="Mismatch · Sepolia" />
          <StatusChip tone="live" text="Live · Sepolia · r1" compact />
        </Specimen>
        <Specimen label="Banners">
          <div className={styles.stack}>
            <Banner text="Chain checks need a connection." tone="info" />
            <Banner text="This project uses catalog 0.4.0, so it's read-only. Migrate it to edit." tone="warning" dismissible />
            <Banner text="Resolve 2 blockers to export · F8" tone="error" />
          </div>
        </Specimen>
        <Specimen label="Hatching">
          <div className={`${hatchedClass} ${styles.swatch}`}>
            <VisuallyHidden>Collision</VisuallyHidden>
          </div>
          <svg className={styles.swatch} viewBox="0 0 96 32" aria-hidden="true">
            <HatchPattern id="lx-hatch-gallery" />
            <rect width="96" height="32" fill={HATCH_FILL.replace("lx-hatch", "lx-hatch-gallery")} />
          </svg>
        </Specimen>
      </GallerySection>

      <GallerySection title="Copy">
        <Specimen label="Copy puts the exact checksummed value on the clipboard">
          <code className={styles.code}>0x5FbD…0aa3</code>
          <IconButton icon="copy" label="Copy address" onClick={() => void copyText(ADDRESS)} />
          <Button size="small" icon="copy" onClick={() => void copyText(ADDRESS, { clipboard: null })}>
            Copy with the clipboard blocked
          </Button>
        </Specimen>
      </GallerySection>

      <GallerySection title="Icons (provisional)">
        <ul className={styles.icons}>
          {ICON_NAMES.map((name) => (
            <li key={name} className={styles.iconCell}>
              <Icon name={name} size="large" />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </GallerySection>
    </>
  );
}
