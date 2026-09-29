import { settings, useSettings } from "@/contracts";
import { RadioGroup, SegmentedToggle } from "@/ui";

/** Settings → Appearance (Flow 16 L629): theme and reduced motion. No board yet (PA L72-L84). */
export function AppearanceGroup() {
  const theme = useSettings((s) => s.theme);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  return (
    <>
      <SegmentedToggle
        label="Theme"
        value={theme}
        onValueChange={(theme) => settings.set({ theme })}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ]}
      />
      <RadioGroup
        label="Reduce motion"
        value={reduceMotion}
        onValueChange={(value) => settings.set({ reduceMotion: value as typeof reduceMotion })}
        options={[
          { value: "system", label: "Follow system" },
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
      />
    </>
  );
}
