import { isNotImplemented } from "@lattice-studio/core";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "@/contracts";
import styles from "./InspectorPanel.module.css";

type Props = {
  children: ReactNode;
  /** When it changes, a caught error clears and the children render again (without remounting them otherwise). */
  resetKey?: string;
};

type State = { error: unknown; resetKey: string | undefined };

/**
 * Keeps a failing view from taking the inspector down. A function another WP hasn't finished (NotImplemented)
 * shows `Not built yet · WP-<id>`; anything else shows its reason and is logged. The frame keys the view's
 * boundary by view, so routing elsewhere starts over; the footer's clears through `resetKey`.
 */
export class ViewBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
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
