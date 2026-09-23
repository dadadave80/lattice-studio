// Renders dist/shiki-shop.json and dist/shiki-draft.json: Shiki themes for
// Solidity and JSON, built only from this theme's own role colors (no new
// hues), on `ground-well` (where code blocks sit per design/tokens.json).

import { themeRoles, type ThemeId, type ThemeRoles } from "./roles.ts";

interface TokenColorRule {
  readonly scope: readonly string[];
  readonly settings: { readonly foreground: string; readonly fontStyle?: string };
}

function tokenColors(roles: ThemeRoles): TokenColorRule[] {
  return [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: roles.textFaint, fontStyle: "italic" },
    },
    { scope: ["string", "string.quoted"], settings: { foreground: roles.text } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: roles.accent } },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.operator",
        "storage.modifier",
        "storage.type.function.solidity",
      ],
      settings: { foreground: roles.accent, fontStyle: "bold" },
    },
    { scope: ["storage.type"], settings: { foreground: roles.textMuted, fontStyle: "bold" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type"], settings: { foreground: roles.text } },
    { scope: ["entity.name.function"], settings: { foreground: roles.text, fontStyle: "bold" } },
    { scope: ["variable", "variable.parameter", "variable.other"], settings: { foreground: roles.text } },
    { scope: ["support.function", "meta.function-call"], settings: { foreground: roles.text } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: roles.textMuted } },
    { scope: ["support.type.property-name.json", "meta.object-literal.key"], settings: { foreground: roles.textMuted } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: roles.accent, fontStyle: "underline" } },
  ];
}

function shikiTheme(theme: ThemeId): Record<string, unknown> {
  const roles = themeRoles(theme);
  const type = theme === "shop" ? "dark" : "light";
  return {
    name: `lattice-studio-${theme}`,
    type,
    colors: {
      "editor.background": roles.groundWell,
      "editor.foreground": roles.text,
      "editorLineNumber.foreground": roles.textFaint,
      "editorLineNumber.activeForeground": roles.textMuted,
      "editorCursor.foreground": roles.accent,
      "editor.selectionBackground": roles.accentSoft,
    },
    tokenColors: tokenColors(roles).map((rule) => ({
      scope: rule.scope,
      settings: rule.settings,
    })),
  };
}

export function renderShikiTheme(theme: ThemeId): string {
  return `${JSON.stringify(shikiTheme(theme), null, 2)}\n`;
}
