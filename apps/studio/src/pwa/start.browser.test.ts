import { describe, expect, test } from "vitest";
import { createConnection } from "./connection";
import { serviceWorkerUrl, startPwa } from "./start";
import { pwaState } from "./state";

describe("startPwa", () => {
  test("the worker and its scope sit under the base: / on Vercel, ./ on IPFS", () => {
    expect(serviceWorkerUrl("/")).toEqual({ url: "/sw.js", scope: "/" });
    expect(serviceWorkerUrl("./")).toEqual({ url: "./sw.js", scope: "./" });
  });

  test("registers nothing outside a production build", () => {
    const connection = createConnection({
      target: new EventTarget(),
      onLine: () => true,
      probe: async () => true,
      setTimeout: () => 0,
      clearTimeout: () => {},
    });
    const stop = startPwa(connection);
    expect(pwaState.updates()).toBeNull();
    stop();
  });
});
