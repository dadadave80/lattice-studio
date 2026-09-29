/**
 * Flow 10's words (spec L503-L505, IR L178-L179, L203-L206). Light enough for the entry chunk: the commands'
 * titles and reasons and the read-only banners read them.
 */
import type { Hex } from "@lattice-studio/core";
import { shortHash } from "@/app/format";

/** The read-only reasons (spec L389), which are also the banners' text (IR L204-L206) and Deploy's reason. */
export const ELSEWHERE = "Another tab is editing this project";
export const HANDED_OVER = "Editing moved to another tab";
export const UNBUNDLED = "This project's catalog isn't bundled";

/** Share is offered once the sheet has facets (IR L71); the empty state's own words (spec L378). */
export const PLACE_FACETS_FIRST = "Place facets first";

/** Banner ids (not contracted: see the report's CCR on banner ordering). */
export const READ_ONLY_BANNER = "flows.read-only";
export const SHARED_LINK_BANNER = "flows.shared-link";

/** Spec L504, word for word. */
export function sharedLinkBanner(hash: Hex): string {
  return `Opened from a shared link · recipe ${shortHash(hash)}. Nothing runs until you choose to deploy.`;
}

/** Spec L503: "Link copied · 732 characters". */
export function linkCopied(characters: number): string {
  return `Link copied · ${characters.toLocaleString("en-US")} characters`;
}

/** "0.4.1" for the tag "v0.4.1"; other tags as they are. */
export function catalogVersion(tag: string): string {
  return tag.replace(/^v(?=[0-9])/, "");
}

/** The command's title, the banner's button (spec L290): "Migrate to 0.4.1…". */
export function migrateTitle(tag: string | null): string {
  return tag === null ? "Migrate to another catalog…" : `Migrate to ${catalogVersion(tag)}…`;
}

/** The history reset line (spec L494), as S7a words taking over: "… Undo history starts here." */
export function migratedLine(tag: string): string {
  return `Migrated to catalog ${catalogVersion(tag)}. Undo history starts here.`;
}
