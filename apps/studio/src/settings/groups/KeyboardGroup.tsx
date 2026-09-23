import type { Platform } from "@lattice-studio/core";
import { useEffect, useState } from "react";
import {
  announce, getCommand, listBindings, settings, useSettings, type BindingId, type ResolvedBinding,
} from "@/contracts";
import {
  bindingTitle, CATEGORY_ORDER, checkRemap, isRemapped, remapBinding, resetBinding, resetKeymap, specFromEvent,
  type KeyConflict,
} from "@/commands";
import { Button, Kbd, Switch, usePlatform } from "@/ui";
import styles from "./KeyboardGroup.module.css";

type Pending = { id: BindingId; spec: string; platform: Platform; reason: string; conflicts: KeyConflict[] };

/** The binding's command category, recovered from the registry (`listBindings` doesn't carry it). */
function categoryOf(binding: ResolvedBinding): string {
  try {
    return getCommand(binding.ref.id).category;
  } catch {
    return "Session";
  }
}

/**
 * Settings → Keyboard (Flow 16): single-key shortcuts on or off, and every remappable shortcut grouped by
 * category, with conflict detection and a per-row and an all-up Reset. No board yet (PA L72-L84); this reads
 * as a list, the nearest drawn pattern to the Keyboard shortcuts dialog it complements.
 */
export function KeyboardGroup() {
  const singleKeys = useSettings((s) => s.singleKeys);
  const keymap = useSettings((s) => s.keymap);
  const platform = usePlatform();
  const [capturing, setCapturing] = useState<BindingId | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const bindings = listBindings(keymap);
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    rows: bindings.filter((b) => categoryOf(b) === category),
  })).filter((g) => g.rows.length > 0);

  const cancel = () => {
    setCapturing(null);
    setPending(null);
  };

  const apply = (id: BindingId, keys: readonly [{ keys: string; platform: Platform }], replace: boolean) => {
    const result = remapBinding(id, keys, { platform, replace });
    if (result.ok) {
      setCapturing(null);
      setPending(null);
      setStatus(result.text);
      announce(result.text);
      return;
    }
    if (result.conflicts.length > 0 && !replace) {
      const [{ keys: spec }] = keys;
      setPending({ id, spec, platform, reason: result.reason, conflicts: result.conflicts });
      announce(result.reason);
      return;
    }
    setCapturing(null);
    setPending(null);
    setStatus(result.reason);
    announce(result.reason);
  };

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      const spec = specFromEvent(event, platform);
      if (spec === null) return; // a modifier alone: keep listening
      if (event.key !== "Tab") event.preventDefault();
      const check = checkRemap(capturing, [{ keys: spec, platform }], { platform });
      if (check && check.conflicts.length === 0) {
        setCapturing(null);
        setStatus(check.reason);
        announce(check.reason);
        return;
      }
      apply(capturing, [{ keys: spec, platform }], false);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    // `apply` and `cancel` close over `capturing`/`platform` freshly each render; re-attaching on every
    // capturing/platform change keeps the listener's closure current without adding them as separate deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, platform]);

  return (
    <div className={styles.group}>
      <Switch
        label="Single-key shortcuts"
        checked={singleKeys}
        onCheckedChange={(checked) => settings.set({ singleKeys: checked })}
        description="Letters, digits and symbols with no modifier (WCAG 2.1.4). Off while typing, and inside trees, lists, menus, the console and the palette either way."
      />
      {status ? <output className={styles.status}>{status}</output> : null}
      {groups.map((group) => (
        <section key={group.category} className={styles.section} aria-label={group.category}>
          <h3 className={styles.heading}>{group.category}</h3>
          <ul className={styles.rows}>
            {group.rows.map((binding) => (
              <li key={binding.id} className={styles.row}>
                <span className={styles.title}>{bindingTitle(binding)}</span>
                <span className={styles.keys}>
                  {binding.keys.length === 0 ? (
                    <span className={styles.none}>No shortcut</span>
                  ) : (
                    binding.keys.map((k, i) => (
                      <span key={i} className={styles.key}>
                        <Kbd keys={k} />
                      </span>
                    ))
                  )}
                </span>
                {capturing === binding.id ? (
                  <output className={styles.listening}>Press a key, or Esc to cancel</output>
                ) : (
                  <Button
                    size="small"
                    onClick={() => {
                      setStatus(null);
                      setPending(null);
                      setCapturing(binding.id);
                    }}
                  >
                    Change…
                  </Button>
                )}
                {isRemapped(binding.id, keymap) ? (
                  <Button
                    size="small"
                    variant="quiet"
                    onClick={() => {
                      const text = resetBinding(binding.id);
                      setStatus(text);
                      announce(text);
                    }}
                  >
                    Reset
                  </Button>
                ) : null}
                {pending && pending.id === binding.id ? (
                  <div className={styles.conflict} role="alert">
                    <p>{pending.reason}</p>
                    <Button
                      size="small"
                      onClick={() => apply(pending.id, [{ keys: pending.spec, platform: pending.platform }], true)}
                    >
                      Use this key anyway
                    </Button>
                    <Button size="small" variant="quiet" onClick={cancel}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button
        variant="quiet"
        onClick={() => {
          const text = resetKeymap();
          setStatus(text);
          announce(text);
        }}
      >
        Reset all shortcuts
      </Button>
    </div>
  );
}
