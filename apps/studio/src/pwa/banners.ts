/**
 * The Offline banner and the chunk-failure banner (IR L208-L210). Both live in the entry chunk: the first must
 * show without a network, the second when a chunk can't load.
 */
import type { LineDraft } from "@lattice-studio/core";
import type { BannerProps } from "@/contracts";
import { BANNERS } from "./copy";

type Banners = { showBanner(id: string, props: BannerProps): void; hideBanner(id: string): void };

/** Shows "Offline. Composing works; deploy needs a connection." while offline; it clears itself. */
export function watchOffline(
  deps: Banners & { isOnline(): boolean; subscribe(listener: (online: boolean) => void): () => void },
): () => void {
  let showing = false;
  const sync = (online: boolean) => {
    if (online === !showing) return;
    showing = !online;
    if (showing) deps.showBanner(BANNERS.offline.id, { text: BANNERS.offline.text, tone: "warning" });
    else deps.hideBanner(BANNERS.offline.id);
  };
  sync(deps.isOnline());
  const stop = deps.subscribe(sync);
  return () => {
    stop();
    if (showing) deps.hideBanner(BANNERS.offline.id);
    showing = false;
  };
}

function detailOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
}

/** What a failed chunk says in the console, after the banner. */
export function chunkFailureLine(reason: unknown): LineDraft {
  const detail = detailOf(reason);
  return { tag: "Error", text: detail ? `Couldn't load part of Studio: ${detail}` : "Couldn't load part of Studio." };
}

/** A chunk that failed because the network is gone: the Offline banner already says so (spec L832). */
export function offlineChunkLine(reason: unknown): LineDraft {
  const detail = detailOf(reason);
  return {
    tag: "Note",
    text: detail ? `Couldn't load part of Studio while offline: ${detail}` : "Couldn't load part of Studio while offline.",
  };
}

/** Shows "Studio was updated. Save and reload to continue." with **Save and reload**. */
export function showChunkFailure(deps: Banners & { log(line: LineDraft): void }, reason: unknown): void {
  deps.showBanner(BANNERS.updated.id, {
    text: BANNERS.updated.text,
    tone: "warning",
    actions: [{ id: "app.saveAndReload" }],
  });
  deps.log(chunkFailureLine(reason));
}
