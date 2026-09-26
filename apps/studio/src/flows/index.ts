/**
 * S13: share links, migrate and the read-only flows (Flow 10 steps 6-8). Other modules reach them through the
 * commands (`share.copyLink`, `link.confirmAddresses`, `project.takeOverEditing`, `catalog.migrate`), the
 * contracts' `openShareLink`, the "share" and "migrate" dialogs and the "confirm-addresses" inspector view. This
 * barrel holds only the read-only reasons, so importing it never pulls a dialog or the codec into the entry chunk.
 */
export { ELSEWHERE, HANDED_OVER, UNBUNDLED } from "./copy";
