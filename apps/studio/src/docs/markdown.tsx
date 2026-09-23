/**
 * A safe, narrow markdown-to-React renderer for problem docs: no `dangerouslySetInnerHTML`, so content
 * only ever becomes React elements and text nodes. Supports inline code spans and links, paragraphs and
 * bullet lists — everything the docs' content needs and nothing else.
 *
 * A link's target is either an ordinary `https://…` URL (rendered as given) or a `lattice:<path>[#<lines>]`
 * reference, resolved against the live catalog's pinned commit (`latticeUrl`). A `lattice:` link with no
 * commit available (the catalog hasn't loaded) renders as plain text, never a dead link.
 */
import type { ReactNode } from "react";
import { latticeUrl, parseLatticeRef } from "./lattice-link";

const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
const CODE_SPAN = /`([^`]+)`/g;

/** A link's label, which may itself carry one or more `` `code` `` spans ("[`LatticeFactory`](…)"). */
function renderLabel(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  CODE_SPAN.lastIndex = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(<code key={`${keyPrefix}-l${index}`}>{match[1]}</code>);
    last = start + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderInline(text: string, commit: string | null, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  INLINE.lastIndex = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [, code, linkText, target] = match;
    if (code !== undefined) {
      nodes.push(<code key={`${keyPrefix}-${index}`}>{code}</code>);
    } else if (linkText !== undefined && target !== undefined) {
      if (target.startsWith("lattice:")) {
        const { path, lines } = parseLatticeRef(target);
        if (commit) {
          nodes.push(
            <a key={`${keyPrefix}-${index}`} href={latticeUrl(commit, path, lines)} target="_blank" rel="noreferrer">
              {renderLabel(linkText, `${keyPrefix}-${index}`)}
            </a>,
          );
        } else {
          nodes.push(<span key={`${keyPrefix}-${index}`}>{renderLabel(linkText, `${keyPrefix}-${index}`)}</span>);
        }
      } else {
        nodes.push(
          <a key={`${keyPrefix}-${index}`} href={target} target="_blank" rel="noreferrer">
            {renderLabel(linkText, `${keyPrefix}-${index}`)}
          </a>,
        );
      }
    }
    last = start + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Every `lattice:` reference a piece of content text uses, for the "links point at the pin" test. */
export function latticeRefs(text: string): string[] {
  const out: string[] = [];
  INLINE.lastIndex = 0;
  for (const match of text.matchAll(INLINE)) {
    const target = match[3];
    if (target?.startsWith("lattice:")) out.push(target);
  }
  return out;
}

/** The plain text a piece of content text reads as (backticks and link brackets stripped), for `lintCopy`. */
export function plainText(text: string): string {
  return text.replace(INLINE, (whole, code: string | undefined, linkText: string | undefined) => (code ?? linkText ?? whole).replace(/`/g, ""));
}

/** One or more `\n\n`-separated paragraphs, each inline-parsed. */
export function renderParagraphs(text: string, commit: string | null, keyPrefix: string): ReactNode {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={`${keyPrefix}-p${i}`}>{renderInline(p, commit, `${keyPrefix}-p${i}`)}</p>
      ))}
    </>
  );
}

/** A bullet list, each item inline-parsed. */
export function renderList(items: readonly string[], commit: string | null, keyPrefix: string): ReactNode {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={`${keyPrefix}-li${i}`}>{renderInline(item, commit, `${keyPrefix}-li${i}`)}</li>
      ))}
    </ul>
  );
}
