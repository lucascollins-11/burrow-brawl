import { describe, expect, it } from "vitest";
import { configFromEnv } from "./config";

describe("configFromEnv", () => {
  const strong = "s".repeat(32);

  it("refuses to start in production without a strong JWT_SECRET", () => {
    expect(() => configFromEnv({ NODE_ENV: "production" })).toThrow("JWT_SECRET must be set");
    expect(() => configFromEnv({ NODE_ENV: "production", JWT_SECRET: "short" })).toThrow(
      "32 bytes",
    );
    expect(configFromEnv({ NODE_ENV: "production", JWT_SECRET: strong }).jwtSecret).toBe(strong);
  });

  it("rejects short secrets outside production too, and generates one in dev", () => {
    expect(() => configFromEnv({ JWT_SECRET: "short" })).toThrow("32 bytes");
    expect(configFromEnv({}).jwtSecret).toHaveLength(64);
  });

  it("parses PORT and ALLOWED_ORIGINS, and forbids * in production", () => {
    const c = configFromEnv({
      JWT_SECRET: strong,
      PORT: "3000",
      ALLOWED_ORIGINS: "https://a.vercel.app/, https://b.dev",
    });
    expect(c.port).toBe(3000);
    expect(c.allowedOrigins).toEqual(["https://a.vercel.app", "https://b.dev"]);
    expect(() =>
      configFromEnv({ NODE_ENV: "production", JWT_SECRET: strong, ALLOWED_ORIGINS: "*" }),
    ).toThrow();
    expect(() => configFromEnv({ JWT_SECRET: strong, PORT: "abc" })).toThrow("PORT");
  });
});
