/**
 * Fix buttons say the spec's words (WP-FX24): INIT-03's roles fix ("Use one admin", spec L329), AUTH-02's
 * ("Use \"This diamond\"", spec L333) and SEL-04's ("Remove it", spec L314). SEL-01's "Keep {A}" is `selector.route`,
 * unchanged here; it's the model these follow.
 */
import { describe, expect, test } from "bun:test";
import type { CommandArgsOf } from "@/contracts";
import { setArgCommand } from "./init";
import { clearOwnerCommand } from "./selectors";

describe("init.setArg's title", () => {
  const args = (extra: Partial<CommandArgsOf<"init.setArg">>): CommandArgsOf<"init.setArg"> => ({
    path: "steps[1].admin",
    value: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    ...extra,
  });

  test('verb: "oneAdmin" reads "Use one admin" (INIT-03, spec L329)', () => {
    expect(setArgCommand.title(args({ verb: "oneAdmin" }))).toBe("Use one admin");
  });

  test('a { $ref: "self" } value reads Use "This diamond" (AUTH-02, spec L333), even with no verb', () => {
    expect(setArgCommand.title(args({ value: { $ref: "self" } }))).toBe('Use "This diamond"');
  });

  test('verb wins over a { $ref: "self" } value', () => {
    expect(setArgCommand.title(args({ value: { $ref: "self" }, verb: "oneAdmin" }))).toBe("Use one admin");
  });

  test("otherwise, Set {field} stays: no catalog loaded falls back to the path", () => {
    expect(setArgCommand.title(args({ path: "bundle.p.quorumNumerator", value: "4" }))).toBe("Set bundle.p.quorumNumerator");
  });

  test('a plain address value with no verb is not mistaken for "This diamond"', () => {
    expect(setArgCommand.title(args({}))).not.toBe('Use "This diamond"');
  });
});

describe("selector.clearOwner's title", () => {
  const args = (extra: Partial<CommandArgsOf<"selector.clearOwner">>): CommandArgsOf<"selector.clearOwner"> => ({
    selector: "0xa9059cbb",
    ...extra,
  });

  test('verb: "remove" reads "Remove it" (SEL-04, spec L314)', () => {
    expect(clearOwnerCommand.title(args({ verb: "remove" }))).toBe("Remove it");
  });

  test("otherwise (SEL-05), Clear owner stays", () => {
    expect(clearOwnerCommand.title(args({}))).toBe("Clear owner");
  });
});
