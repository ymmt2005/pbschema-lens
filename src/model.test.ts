import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileInput } from "../src/node/compile.js";
import { loadRegistryFromBytes } from "../src/core/registry.js";
import { buildModel } from "../src/core/model.js";
import { referenceIntegrity } from "../src/core/references.js";

async function modelFromDir(dir: string) {
  const compiled = await compileInput(dir);
  const registry = loadRegistryFromBytes(compiled.bytes);
  return buildModel(registry, {
    title: "test",
    inputLabel: dir,
    classification: {},
  });
}

describe("schema fixtures", () => {
  it("loads proto2 required fields, aliases, and extensions", async () => {
    const model = await modelFromDir(new URL("../fixtures/proto2", import.meta.url).pathname);
    const message = model.messages.find((item) => item.fullName === "fixtures.proto2.LegacyUser");
    expect(message).toBeTruthy();
    const id = model.fields.find((item) => item.fullName === "fixtures.proto2.LegacyUser.id");
    expect(id?.cardinality).toBe("required");
    const ext = model.extensions.find((item) => item.fullName === "fixtures.proto2.extra_id");
    expect(ext?.number).toBe(100);
    const aliases = model.enums.find((item) => item.fullName === "fixtures.proto2.LegacyState");
    expect(aliases?.allowAlias).toBe(true);
  });

  it("extracts custom options without hard-coded names", async () => {
    const model = await modelFromDir(new URL("../fixtures/options", import.meta.url).pathname);
    const field = model.fields.find((item) => item.fullName === "fixtures.options.Item.secret");
    const names = field?.options.map((option) => option.fullName) ?? [];
    expect(names.some((name) => name.includes("sensitive"))).toBe(true);
    const def = model.extensions.find((item) => item.fullName.endsWith("sensitive"));
    expect(def?.optionTarget).toBe("field");
    expect(def?.referencedBy.length).toBeGreaterThan(0);
  });

  it("sanitizes hostile comments", async () => {
    const model = await modelFromDir(new URL("../fixtures/security", import.meta.url).pathname);
    const message = model.messages.find((item) => item.fullName === "fixtures.security.Nasty");
    const html = message?.comments?.markdownHtml ?? "";
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    const field = model.fields.find((item) => item.fullName === "fixtures.security.Nasty.name");
    expect(field?.comments?.markdownHtml).toContain("<strong>bold</strong>");
    expect(field?.comments?.markdownHtml).not.toContain("javascript:");
  });

  it("keeps reverse edges aligned with forward edges", async () => {
    const model = await modelFromDir(new URL("../fixtures/options", import.meta.url).pathname);
    expect(referenceIntegrity(model)).toEqual([]);
    const paths = Object.values(model.symbols).map((item) => item.urlPath + (item.anchor ?? ""));
    expect(new Set(paths).size).toBeGreaterThan(0);
  });

  it("rejects path traversal when sanitizing outputs", async () => {
    const { sanitizeOutputPath } = await import("../src/node/sources.js");
    expect(() => sanitizeOutputPath("../../etc/passwd")).toThrow();
    expect(sanitizeOutputPath("acme/user.proto")).toBe("acme/user.proto");
  });
});
