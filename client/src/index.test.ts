import { describe, expect, it } from "vitest";
import * as pkg from "./index";

describe("@burrow-brawl/client", () => {
  it("loads its placeholder entry point", () => {
    expect(pkg).toBeTypeOf("object");
  });
});
