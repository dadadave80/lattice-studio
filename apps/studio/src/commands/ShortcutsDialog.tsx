import { useId, useRef, useState } from "react";
import { closeDialog, getCommand, listBindings, useSettings, type DialogComponentProps } from "@/contracts";
import { Button, Dialog, Kbd, TextField, usePlatform } from "@/ui";
import { groupRows, shortcutRows } from "./shortcut-rows";
import styles from "./ShortcutsDialog.module.css";

/**
 * Keyboard shortcuts (IR L186; `?` and the App menu): every shortcut as remapped, grouped by category, with
 * its console syntax, and a search. Initial focus is the search; closing loses nothing, and focus goes back
 * to the control that opened it.
 */
export function ShortcutsDialog({ entry, top }: DialogComponentProps<"keyboard-shortcuts">) {
  const platform = usePlatform();
  const keymap = useSettings((s) => s.keymap);
  const singleKeys = useSettings((s) => s.singleKeys);
  const [query, setQuery] = useState(entry.props.query ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const close = () => closeDialog("keyboard-shortcuts");

  const rows = shortcutRows(listBindings(keymap), (b) => getCommand(b.ref.id), { platform, singleKeys });
  const groups = groupRows(rows, query);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const searching = query.trim() !== "";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Keyboard shortcuts"
      initialFocus={searchRef}
      lossless
      top={top}
      size="wide"
      footer={<Button onClick={close}>Close</Button>}
    >
      <TextField label="Search" value={query} onValueChange={setQuery} inputRef={searchRef} autoComplete="off" spellCheck={false} />
      <output className={styles.status}>{searching ? `Showing ${shown} of ${rows.length}` : ""}</output>
      {singleKeys ? null : <p className={styles.note}>Single-key shortcuts are off. Settings → Keyboard turns them on.</p>}
      {groups.length === 0 ? (
        <p className={styles.empty}>{searching ? `No shortcuts match “${query.trim()}”. Clear the search.` : "No shortcuts."}</p>
      ) : (
        groups.map((group) => {
          const id = `${headingId}-${group.category}`;
          return (
            <section key={group.category} className={styles.group} aria-labelledby={id}>
              <h3 id={id} className={styles.heading}>
                {group.category}
              </h3>
              <ul className={styles.rows}>
                {group.rows.map((row) => (
                  <li key={row.id} className={styles.row}>
                    <span className={styles.title}>{row.title}</span>
                    <span className={styles.keys}>
                      {row.keys.map((k, i) => (
                        <span key={i} className={styles.key}>
                          <Kbd keys={k} />
                        </span>
                      ))}
                    </span>
                    {row.syntax ? <code className={styles.syntax}>{row.syntax}</code> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Dialog>
  );
}
