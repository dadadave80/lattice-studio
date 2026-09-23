import type { LintCopyFn } from "../model/api";
import type { CopyIssue } from "../model/console";

/** British spellings the spec bans in favor of US spelling (spec L676): catalogue, colour, initialise, cancelled, centre, maximise. */
const BRITISH_PATTERNS: readonly RegExp[] = [
  /\bcatalogue(s)?\b/gi,
  /\bcolour(s|ed|ing|ful)?\b/gi,
  /\binitialis(e|es|ed|ing|ation)\b/gi,
  /\bcancell(ed|ing)\b/gi,
  /\bcentre(s|d)?\b/gi,
  /\bmaximis(e|es|ed|ing|ation)\b/gi,
];

/** Common lowercase English words: a title-case run needs at least one, so proper nouns like "DiamondLoupeFacet" never trip it alone. */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "and", "or", "but", "with", "your", "is", "are", "this", "that", "from", "for",
  "in", "on", "at", "it", "its", "be", "was", "were", "as", "by",
]);

function pushMatches(text: string, pattern: RegExp, rule: CopyIssue["rule"], message: (match: string) => string, out: CopyIssue[]): void {
  for (const match of text.matchAll(pattern)) out.push({ rule, match: match[0], index: match.index ?? 0, message: message(match[0]) });
}

/**
 * A run of ≥ 2 consecutive plain-capitalized words (never a PascalCase name, which has internal capitals) in
 * one sentence, with at least one stopword. A sentence-initial word (the text's first word, or one right after
 * ".", "!" or "?") never joins a run by itself, so ordinary sentence case and a lone capital at a sentence's
 * start ("...owned by A. Remove it.") never trip it, and a run never bridges across a sentence boundary.
 */
function findTitleCase(text: string): CopyIssue | null {
  // The negative lookbehind keeps hex runs ("0xA1B2…E5F6") from reading as capitalized words.
  const words = [...text.matchAll(/(?<![0-9A-Za-z])[A-Za-z][A-Za-z']*/g)];
  let run: RegExpMatchArray[] = [];
  let prevEnd = 0;
  const flush = (): CopyIssue | null => {
    const issue = run.length >= 2 && run.some((w) => STOPWORDS.has(w[0].toLowerCase())) ? issueFromRun(run, text) : null;
    run = [];
    return issue;
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === undefined) continue;
    const start = word.index ?? 0;
    const sentenceStart = i === 0 || /[.!?]/.test(text.slice(prevEnd, start));
    prevEnd = start + word[0].length;
    const isPlainCapitalized = /^[A-Z][a-z']*$/.test(word[0]);
    if (!isPlainCapitalized || sentenceStart) {
      const issue = flush();
      if (issue) return issue;
      continue;
    }
    run.push(word);
  }
  return flush();
}

function issueFromRun(run: readonly RegExpMatchArray[], text: string): CopyIssue {
  const first = run[0];
  const last = run[run.length - 1];
  const start = first?.index ?? 0;
  const end = (last?.index ?? 0) + (last?.[0].length ?? 0);
  const match = text.slice(start, end);
  return { rule: "title-case", match, index: start, message: `"${match}" reads as title case; use sentence case (spec L673).` };
}

/** Flags "please", "oops", "!", bare "OK"/"Yes", title-case runs and British spellings (spec L667-L676). */
export const lintCopy: LintCopyFn = (text) => {
  const issues: CopyIssue[] = [];

  pushMatches(text, /please/gi, "please", () => 'Drop "please": copy states what to do, it doesn\'t ask (spec L673).', issues);
  pushMatches(text, /oops/gi, "oops", () => 'Drop "oops": no blame (spec L673).', issues);
  pushMatches(text, /!/g, "exclamation", () => "No exclamation marks (spec L673).", issues);
  for (const pattern of BRITISH_PATTERNS) {
    pushMatches(text, pattern, "british", (match) => `"${match}" is British spelling; use US spelling (spec L676).`, issues);
  }

  const trimmed = text.trim();
  if (/^(ok|yes)$/i.test(trimmed)) {
    issues.push({
      rule: "ok-yes",
      match: trimmed,
      index: text.indexOf(trimmed),
      message: 'Never "OK" or "Yes": say what the action does (spec L673).',
    });
  }

  const titleCase = findTitleCase(text);
  if (titleCase) issues.push(titleCase);

  return issues;
};
