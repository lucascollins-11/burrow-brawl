import { describe, expect, it } from "vitest";
import * as pkg from "./index";

describe("@burrow-brawl/shared", () => {
  it("loads its placeholder entry point", () => {
    expect(pkg).toBeTypeOf("object");
  });
});
