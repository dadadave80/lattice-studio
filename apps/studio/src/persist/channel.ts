/**
 * The tabs' BroadcastChannel (spec L505): edits reach the other tabs, deployment writes tell every tab to
 * read the records again, and the edit lock's handover is negotiated here. Each tab (each persistence
 * instance) has a peer id; a channel never hears its own messages.
 */
import type { Project } from "@lattice-studio/core";

export type ChannelMessage =
  /** The editing tab changed the project; read-only tabs showing it load it. */
  | { kind: "change"; from: string; id: string; project: Project }
  /** Deployment records of `projectId` were written. */
  | { kind: "deployments"; from: string; projectId: string }
  /** `from` asks the holder of project `id`'s edit lock to save and hand it over. */
  | { kind: "lock-request"; from: string; id: string }
  /** The holder heard `to`'s request and is saving before it lets go: wait, don't steal. */
  | { kind: "lock-ack"; from: string; id: string; to: string }
  /**
   * The projects list changed in another tab. `trashed` went to Recently deleted, `restored` came back, and
   * `cleared` means every project went (Clear data): a tab holding one of them stops writing it.
   */
  | { kind: "projects"; from: string; trashed?: string[]; restored?: string[]; gone?: string[]; cleared?: true };

export type Channel = {
  post(message: ChannelMessage): void;
  subscribe(listener: (message: ChannelMessage) => void): () => void;
  close(): void;
};

function isMessage(value: unknown): value is ChannelMessage {
  return value !== null && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string";
}

/** A BroadcastChannel, or a silent stand-in where the browser has none. */
export function openChannel(name: string): Channel {
  const listeners = new Set<(message: ChannelMessage) => void>();
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => {}, subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)), close: () => {} };
  }
  const channel = new BroadcastChannel(name);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (!isMessage(event.data)) return;
    for (const listener of Array.from(listeners)) listener(event.data);
  };
  let closed = false;
  return {
    post(message) {
      if (closed) return;
      try {
        channel.postMessage(message);
      } catch {
        // A project that can't be cloned never reaches the other tab; it still saves here.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
      channel.close();
    },
  };
}
