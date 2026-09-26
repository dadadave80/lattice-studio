import { describe, expect, test } from "bun:test";
import * as review from "@/chain/review/entry-copy";
import { elapsedText as reviewElapsed } from "@/chain/review/progress-view";
import { elapsedText, IN_FLIGHT_PHASES, ON_ITS_WAY, pathName } from "./copy";

describe("the chrome's mirrors of S8b's words", () => {
  test("agree with S8b's", () => {
    expect(ON_ITS_WAY).toBe(review.ON_ITS_WAY);
    expect([...IN_FLIGHT_PHASES].sort()).toEqual([...review.IN_FLIGHT_PHASES].sort());
    expect(pathName("factory")).toBe(review.pathName("factory"));
    expect(pathName("createx")).toBe(review.pathName("createx"));
  });

  test("the pending timer reads as S8b's does", () => {
    const since = "2026-09-23T12:00:00.000Z";
    const start = Date.parse(since);
    for (const ms of [0, 12_000, 65_000, 3_600_000, -5_000]) {
      expect(elapsedText(since, start + ms)).toBe(reviewElapsed(since, start + ms));
    }
    expect(elapsedText(undefined, start)).toBeNull();
    expect(elapsedText("not a time", start)).toBeNull();
    expect(elapsedText(since, start + 12_000)).toBe("0:12");
  });
});
