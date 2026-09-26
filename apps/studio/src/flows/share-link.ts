/**
 * Share (Flow 10 step 6, spec L291, L503): the `#s=1.…` link for the open project, copied with its length, or
 * over 2,000 characters (Discord's message limit) the Share dialog. Loaded on use: it carries the codec.
 */
import type { Project, Recipe } from "@lattice-studio/core";
import { encodeShareLink, SHARE_WARN_LENGTH } from "@lattice-studio/core";
import { openDialog } from "@/contracts";
import { copyText, type CopyResult } from "@/ui/copy/copy-text";
import { linkCopied } from "./copy";

/** What a link carries: the recipe, named after the project (spec L212: `name` is written in share links). */
export function sharedRecipe(project: Project): Recipe {
  return { ...project.recipe, name: project.name };
}

/** The page's address without its fragment, then the link's: the length people paste is the whole URL. */
export function shareUrl(project: Project, href: string = location.href): string {
  const at = href.indexOf("#");
  const base = at < 0 ? href : href.slice(0, at);
  return `${base}${encodeShareLink(sharedRecipe(project)).fragment}`;
}

/** Copies the link and says "Link copied · 732 characters", or opens the Share dialog when it's too long. */
export async function copyShareLink(
  project: Project,
  options: { href?: string; clipboard?: Pick<Clipboard, "writeText"> | null } = {},
): Promise<CopyResult | "dialog"> {
  const link = shareUrl(project, options.href);
  if (link.length > SHARE_WARN_LENGTH) {
    openDialog("share", { link });
    return "dialog";
  }
  return copyText(link, { message: linkCopied(link.length), ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }) });
}
