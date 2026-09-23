import { expect, test } from "bun:test";
import { API_OWNERS } from "../../model/api";
import * as mod from "./index";

test("the barrel exports exactly C4a's four functions, none of them stubs", () => {
  expect(Object.keys(mod).sort()).toEqual(["autoOrder", "fieldModel", "planInit", "validateArg"]);
  for (const name of Object.keys(mod)) expect(API_OWNERS[name as keyof typeof API_OWNERS]).toBe("C4a");
});
