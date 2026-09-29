/**
 * Shiki, in its own lazy chunk (spec L813, L822): the fine-grained core with Solidity and JSON only, the
 * JavaScript regex engine (the Oniguruma engine needs `wasm-unsafe-eval`, which the CSP forbids, spec L863), and
 * both Studio themes at once. Tokens come back as data with each theme's color as a CSS custom property
 * (`--shiki-dark`, `--shiki-light`), which the Code view sets through React's `style` (CSSOM, allowed by the CSP)
 * and its stylesheet picks by `data-theme`. No HTML output: Shiki's HTML carries inline style attributes.
 */
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import json from "@shikijs/langs/json";
import solidity from "@shikijs/langs/solidity";
import light from "@lattice-studio/tokens/shiki-light.json";
import dark from "@lattice-studio/tokens/shiki-dark.json";
import { createHighlighterCore, type ThemeRegistration } from "shiki/core";
import type { CodeLang, Highlighter, HighlightToken } from "./highlight";

const THEMES = { dark: dark as ThemeRegistration, light: light as ThemeRegistration };

export async function createHighlighter(): Promise<Highlighter> {
  const core = await createHighlighterCore({
    themes: [THEMES.dark, THEMES.light],
    langs: [solidity, json],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  const themes = { dark: THEMES.dark.name ?? "lattice-studio-dark", light: THEMES.light.name ?? "lattice-studio-light" };
  return {
    tokenize(code: string, lang: CodeLang): HighlightToken[][] {
      const { tokens } = core.codeToTokens(code, { lang, themes, defaultColor: false });
      return tokens.map((line) => line.map((token) => ({ content: token.content, style: token.htmlStyle ?? {} })));
    },
  };
}
