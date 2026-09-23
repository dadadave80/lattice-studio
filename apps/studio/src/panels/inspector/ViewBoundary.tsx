import { isNotImplemented } from "@lattice-studio/core";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "@/contracts";
import styles from "./InspectorPanel.module.css";

type State = { error: unknown };

/**
 * Keeps a failing view from taking the inspector down. A function another WP hasn't finished (NotImplemented)
 * shows `Not built yet · WP-<id>`; anything else shows its reason and is logged. The frame keys it by view, so
 * routing elsewhere starts over.
 */
export class ViewBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    if (isNotImplemented(error)) return;
    const reason = error instanceof Error ? error.message : String(error);
    log({ tag: "Error", text: `The inspector couldn't show this view: ${reason}` });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const text = isNotImplemented(error) || error instanceof Error ? error.message : String(error);
    return (
      <p className={styles.placeholder}>
        {isNotImplemented(error) ? text : `The inspector couldn't show this view: ${text}`}
      </p>
    );
  }
}
