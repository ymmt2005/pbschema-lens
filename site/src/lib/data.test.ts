import { afterEach, describe, expect, it } from "vitest";
import { canonicalHref, configuredBase, withBase } from "./data.ts";

const previous = process.env.PBSCHEMA_LENS_BASE;

afterEach(() => {
  if (previous === undefined) delete process.env.PBSCHEMA_LENS_BASE;
  else process.env.PBSCHEMA_LENS_BASE = previous;
});

describe("site base and canonical URL", () => {
  it("prefixes paths with the configured base", () => {
    process.env.PBSCHEMA_LENS_BASE = "/docs/";
    expect(configuredBase()).toBe("/docs/");
    expect(withBase("/explore/")).toBe("/docs/explore/");
    process.env.PBSCHEMA_LENS_BASE = "/docs";
    expect(withBase("/explore/")).toBe("/docs/explore/");
    process.env.PBSCHEMA_LENS_BASE = "/";
    expect(configuredBase()).toBe("/");
    expect(withBase("/explore/")).toBe("/explore/");
  });

  it("builds a canonical URL from siteUrl and the page path", () => {
    expect(canonicalHref("https://example.com", "/docs/")).toBe("https://example.com/docs/");
    expect(canonicalHref(undefined, "/docs/")).toBeUndefined();
  });
});
