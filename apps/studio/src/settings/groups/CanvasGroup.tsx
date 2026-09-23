import { useState } from "react";
import { settings, useSettings } from "@/contracts";
import { NumberField, SegmentedToggle, Switch } from "@/ui";

function commitInteger(text: string, onCommit: (value: number) => void): void {
  const parsed = Number.parseInt(text, 10);
  if (Number.isFinite(parsed) && parsed >= 1 && String(parsed) === text.trim()) onCommit(parsed);
}

/** Settings → Canvas (Flow 16 L629): scroll wheel, nudge step and the minimap. No board yet (PA L72-L84). */
export function CanvasGroup() {
  const wheel = useSettings((s) => s.wheel);
  const nudge = useSettings((s) => s.nudge);
  const minimap = useSettings((s) => s.minimap);
  const [small, setSmall] = useState(String(nudge.small));
  const [large, setLarge] = useState(String(nudge.large));
  // The setting can change from outside these fields (a reset, another tab): adjusted during render (the
  // documented React pattern), not an effect, so neither ever shows a stale value for even one frame.
  const [syncedWith, setSyncedWith] = useState(nudge);
  if (nudge !== syncedWith) {
    setSyncedWith(nudge);
    setSmall(String(nudge.small));
    setLarge(String(nudge.large));
  }

  return (
    <>
      <SegmentedToggle
        label="Scroll wheel"
        value={wheel}
        onValueChange={(wheel) => settings.set({ wheel })}
        options={[
          { value: "pan", label: "Pan" },
          { value: "zoom", label: "Zoom" },
        ]}
      />
      <NumberField
        label="Small nudge"
        value={small}
        onValueChange={(text) => {
          setSmall(text);
          commitInteger(text, (value) => settings.set({ nudge: { ...settings.get().nudge, small: value } }));
        }}
        step={1}
        min="1"
      />
      <NumberField
        label="Large nudge"
        value={large}
        onValueChange={(text) => {
          setLarge(text);
          commitInteger(text, (value) => settings.set({ nudge: { ...settings.get().nudge, large: value } }));
        }}
        step={1}
        min="1"
      />
      <Switch label="Show minimap" checked={minimap} onCheckedChange={(minimap) => settings.set({ minimap })} />
    </>
  );
}
