/**
 * Whether the title bar's middle is crowded (spec L370: "the project name truncates first, then the chip
 * shrinks to its dot and one word"). The name gives way first, down to its minimum width; when the middle
 * still overflows, this turns true until the middle grows past the width where it overflowed. `content` names
 * what's shown (the chip's words): a change measures again from the full form.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export function useCrowded(container: RefObject<HTMLElement | null>, content: string): boolean {
  const [crowdedFor, setCrowdedFor] = useState<string | null>(null);
  const crowdedAt = useRef<number | null>(null);
  const crowded = crowdedFor === content;

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    if (!crowded) crowdedAt.current = null;
    const check = () => {
      const width = el.clientWidth;
      if (crowdedAt.current === null) {
        if (el.scrollWidth > width + 0.5) {
          crowdedAt.current = width;
          setCrowdedFor(content);
        }
      } else if (width > crowdedAt.current) {
        crowdedAt.current = null;
        setCrowdedFor(null);
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, content, crowded]);

  return crowded;
}
