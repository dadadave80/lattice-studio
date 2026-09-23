import { describe, expect, test } from "bun:test";
import type { MechanismOption } from "@lattice-studio/core";
import { loadTemplate, mechanismOptions } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { applyLabel, currentValues, formInputs, initialChoice, needsOf, optionDescription, type MechanismForm } from "./mechanism-form";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog = loaded.value;

const base: MechanismForm = { choice: "safe", keep: false, safe: "", threshold: "", delay: "", delayUnit: "days" };

describe("Choose an upgrade mechanism: Fill in (spec L650)", () => {
  test("asks only for what the choice needs", () => {
    expect(needsOf({ choice: "safe", keep: false })).toEqual({ safe: true, threshold: true, delay: false });
    expect(needsOf({ choice: "safe-delay", keep: false })).toEqual({ safe: true, threshold: true, delay: true });
    expect(needsOf({ choice: "admin", keep: false })).toEqual({ safe: false, threshold: false, delay: false });
    expect(needsOf({ choice: "admin", keep: true })).toEqual({ safe: true, threshold: false, delay: false });
    expect(needsOf({ choice: "immutable", keep: false })).toEqual({ safe: false, threshold: false, delay: false });
  });

  test("turns what was typed into inputs, checksummed, and says what's wrong in the field's words", () => {
    const ok = formInputs({ ...base, choice: "safe-delay", safe: "0x71c7656ec7ab88b098defb751b7401b5f6d8976f", threshold: "2", delay: "2", delayUnit: "days" }, catalog);
    expect(ok).toEqual({ inputs: { safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", minThreshold: "2", delay: "172800" }, errors: {} });
    expect(formInputs({ ...base, safe: "This diamond" }, catalog).inputs.safe).toEqual({ $ref: "self" });
    const bad = formInputs({ ...base, safe: "0x12", threshold: "0" }, catalog);
    expect(bad.errors.safe).toBe("Safe is 0x12; it isn't an address.");
    expect(bad.errors.threshold).toBe("Minimum threshold is 0; it must be at least 1.");
    expect(formInputs({ ...base, choice: "admin", keep: true, safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" }, catalog).inputs)
      .toEqual({ keepMechanism: true, safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" });
  });

  test("starts from the preset, else the current mechanism, and from the recipe's own values", () => {
    const recipe = loadTemplate(catalog, "SafeDiamondCut");
    if (!recipe.ok) throw new Error(recipe.error);
    const options = mechanismOptions(recipe.value, catalog);
    expect(initialChoice(options.options, options.current, undefined)).toBe("safe");
    expect(initialChoice(options.options, options.current, "governance")).toBe("governance");
    expect(initialChoice(options.options, null, undefined)).toBe("admin");
    expect(currentValues(recipe.value)).toEqual({ safe: "", threshold: "2", delay: "" });
  });

  test("labels the primary button with the facet it places (spec L652) and each option with who and how fast", () => {
    const safe: MechanismOption = { id: "safe", label: "Safe", facet: "SafeDiamondCut", summary: "only the pinned Safe cuts, at its threshold", enabled: true };
    const immutable: MechanismOption = { id: "immutable", label: "Immutable", summary: "no mechanism, which is the same as Keep immutable", enabled: true };
    const admin: MechanismOption = { id: "admin", label: "Admin role", facet: "AccessControlDiamondCut", summary: "holders of `DEFAULT_ADMIN_ROLE` cut at once", enabled: true };
    expect(applyLabel(safe)).toBe("Use SafeDiamondCut");
    expect(applyLabel(immutable)).toBe("Keep immutable");
    expect(optionDescription(admin)).toBe("AccessControlDiamondCut: holders of DEFAULT_ADMIN_ROLE cut at once.");
    expect(optionDescription(immutable)).toBe("No mechanism, which is the same as Keep immutable.");
  });
});
