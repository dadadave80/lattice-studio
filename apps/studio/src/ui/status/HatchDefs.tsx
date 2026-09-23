import { HatchPattern } from "./HatchPattern";

/** A zero-size svg holding the shared pattern, for pages whose SVGs reference `#lx-hatch`. */
export function HatchDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <HatchPattern />
    </svg>
  );
}
