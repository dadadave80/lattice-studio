import { describe, expect, test } from "bun:test";
import { summarizeLighthouse, type Lhr } from "./lighthouse.ts";

function lhr(lcp: number): Lhr {
  return {
    configSettings: { formFactor: "mobile", throttlingMethod: "simulate", throttling: { cpuSlowdownMultiplier: 4, rttMs: 150, throughputKbps: 1638.4 } },
    audits: {
      "largest-contentful-paint": { numericValue: lcp },
      "first-contentful-paint": { numericValue: 900 },
      "total-blocking-time": { numericValue: 120 },
      "lcp-phases-insight": {
        details: {
          type: "list",
          items: [
            { type: "table", items: [{ phase: "timeToFirstByte", label: "Time to first byte", duration: 4 }, { label: "Element render delay", duration: 800 }] },
            { type: "node", nodeLabel: "A diamond only your Safe can upgrade", selector: "span._recipeBlurb" },
          ],
        },
      },
      "network-requests": {
        details: { items: [{ url: "http://localhost:1/a.js", transferSize: 300 }, { url: "http://localhost:1/b.json", transferSize: 900 }, { url: "http://localhost:1/c.css" }] },
      },
    },
  };
}

describe("summarizeLighthouse", () => {
  test("keeps every run's metrics and the last run's LCP element, phases and requests", () => {
    const s = summarizeLighthouse([lhr(7000), lhr(8000)]);
    expect(s.runs).toBe(2);
    expect(s.lcp).toEqual([7000, 8000]);
    expect(s.fcp).toEqual([900, 900]);
    expect(s.lcpElement).toBe('"A diamond only your Safe can upgrade" (span._recipeBlurb)');
    expect(s.lcpPhases).toEqual({ "Time to first byte": 4, "Element render delay": 800 });
    expect(s.requests).toEqual({ count: 3, bytes: 1200 });
    expect(s.largest[0]).toEqual({ url: "http://localhost:1/b.json", bytes: 900 });
    expect(s.formFactor).toBe("mobile");
    expect(s.throttling).toBe("simulate, 4× CPU, 150 ms RTT, 1638 Kbps");
  });

  test("no runs", () => {
    const s = summarizeLighthouse([]);
    expect(s.runs).toBe(0);
    expect(s.lcpElement).toBeNull();
    expect(s.largest).toEqual([]);
  });

  test("a report without the insight or the requests audit", () => {
    const s = summarizeLighthouse([{ audits: { "largest-contentful-paint": { numericValue: 1000 } } }]);
    expect(s.lcp).toEqual([1000]);
    expect(s.fcp[0]).toBeNaN();
    expect(s.lcpPhases).toEqual({});
    expect(s.requests).toEqual({ count: 0, bytes: 0 });
    expect(s.throttling).toBe("unknown");
  });
});
