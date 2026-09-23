import { useSettings, type KeySpec } from "@/contracts";
import { usePlatform } from "../shared/platform";
import { ariaKeyShortcuts, isSingleKey, specKeys } from "./key-labels";

/** The specs that are live now: this platform's, minus single-key ones while those are off (spec L659). */
export function liveSpecs(
  specs: readonly KeySpec[] | KeySpec | undefined,
  platform: "mac" | "other",
  singleKeys: boolean,
): KeySpec[] {
  if (specs === undefined) return [];
  const list = Array.isArray(specs) ? specs : [specs as KeySpec];
  return list.filter((s) => {
    const k = specKeys(s, platform);
    return k !== null && (singleKeys || !isSingleKey(k));
  });
}

/**
 * The `aria-keyshortcuts` props for a control (spec L750), as a spreadable object: empty when no shortcut
 * applies on this platform, or when it's a single-key shortcut and single-key shortcuts are off. The same
 * filter as `ShortcutChip`, so what's announced is what's shown.
 */
export function useAriaKeyShortcuts(specs: readonly KeySpec[] | KeySpec | undefined): { "aria-keyshortcuts"?: string } {
  const platform = usePlatform();
  const singleKeys = useSettings((s) => s.singleKeys);
  const value = ariaKeyShortcuts(liveSpecs(specs, platform, singleKeys), platform);
  return value ? { "aria-keyshortcuts": value } : {};
}
