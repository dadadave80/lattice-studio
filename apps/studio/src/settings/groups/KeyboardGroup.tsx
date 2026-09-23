import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  announce, getCommand, listBindings, pushEscape, settings, useSettings, type BindingId, type KeySpec,
  type ResolvedBinding,
} from "@/contracts";
import {
  bindingTitle, CATEGORY_ORDER, checkRemap, isRemapped, remapBinding, resetBinding, resetKeymap, specFromEvent,
  type KeyConflict,
} from "@/commands";
import { Button, Kbd, Switch, usePlatform } from "@/ui";
import styles from "./KeyboardGroup.module.css";

type Pending = { id: BindingId; keys: readonly KeySpec[]; reason: string; conflicts: KeyConflict[] };

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
  /** The row's "Change…" button, kept across the capturing/pending states so focus never has to jump. */
  const changeRefs = useRef(new Map<BindingId, HTMLButtonElement>());
  const anywayRef = useRef<HTMLButtonElement>(null);

  const bindings = listBindings(keymap);
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    rows: bindings.filter((b) => categoryOf(b) === category),
  })).filter((g) => g.rows.length > 0);

  const focusChange = (id: BindingId) => changeRefs.current.get(id)?.focus();

  const cancel = () => {
    const id = pending?.id ?? capturing;
    setCapturing(null);
    setPending(null);
    if (id) focusChange(id);
  };

  const apply = (id: BindingId, keys: readonly KeySpec[], replace: boolean) => {
    const result = remapBinding(id, keys, { platform, replace });
    if (result.ok) {
      setCapturing(null);
      setPending(null);
      setStatus(result.text);
      announce(result.text);
      focusChange(id);
      return;
    }
    if (result.conflicts.length > 0 && !replace) {
      setCapturing(null);
      setPending({ id, keys, reason: result.reason, conflicts: result.conflicts });
      announce(result.reason);
      return;
    }
    setCapturing(null);
    setPending(null);
    setStatus(result.reason);
    announce(result.reason);
    focusChange(id);
  };

  // The conflict card gets its own Esc, and focus, the moment it appears: while it's up the row's own keydown
  // capture is off (capturing was cleared above), so nothing else would catch Esc but the dialog itself.
  useEffect(() => {
    if (!pending) return;
    anywayRef.current?.focus();
    return pushEscape(() => {
      cancel();
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const onCaptureKeyDown = (id: BindingId) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Stops here, before the app's own shortcut dispatcher (a bubble-phase window listener) ever sees it.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      apply(id, [], false); // listBindings: an empty list unbinds.
      return;
    }
    const spec = specFromEvent(event, platform);
    if (spec === null) return; // a modifier alone: keep listening
    if (event.key !== "Tab") event.preventDefault();
    const check = checkRemap(id, [{ keys: spec, platform }], { platform });
    if (check && check.conflicts.length === 0) {
      setCapturing(null);
      setStatus(check.reason);
      announce(check.reason);
      focusChange(id);
      return;
    }
    apply(id, [{ keys: spec, platform }], false);
  };

  return (
    <div className={styles.group}>
      <Switch
        label="Single-key shortcuts"
        checked={singleKeys}
        onCheckedChange={(checked) => settings.set({ singleKeys: checked })}
        description="Shortcuts match the character a key types, so they follow the person's layout; letter shortcuts fall back to the key's position on non-Latin layouts."
      />
      {status ? <output className={styles.status}>{status}</output> : null}
      {groups.map((group) => (
        <section key={group.category} className={styles.section} aria-label={group.category}>
          <h3 className={styles.heading}>{group.category}</h3>
          <ul className={styles.rows}>
            {group.rows.map((binding) => {
              const isCapturing = capturing === binding.id;
              return (
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
                  <Button
                    ref={(el) => {
                      if (el) changeRefs.current.set(binding.id, el);
                      else changeRefs.current.delete(binding.id);
                    }}
                    size="small"
                    onClick={() => {
                      if (isCapturing) {
                        cancel();
                        return;
                      }
                      setStatus(null);
                      setPending(null);
                      setCapturing(binding.id);
                    }}
                    {...(isCapturing ? { onKeyDown: onCaptureKeyDown(binding.id) } : {})}
                  >
                    {isCapturing ? "Press a key, or Esc to cancel" : "Change…"}
                  </Button>
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
                    <div className={styles.conflict}>
                      <p>{pending.reason}</p>
                      <Button ref={anywayRef} size="small" onClick={() => apply(pending.id, pending.keys, true)}>
                        Use this key anyway
                      </Button>
                      <Button size="small" variant="quiet" onClick={cancel}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
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
