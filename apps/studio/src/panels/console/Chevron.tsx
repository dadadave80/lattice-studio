import styles from "./ConsolePanel.module.css";

/** The collapse toggle's chevron: down while the drawer is open, up while it's collapsed. Decorative. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={styles.chevron} data-open={open ? "" : undefined} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
