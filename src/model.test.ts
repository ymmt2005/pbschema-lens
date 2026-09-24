import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileInput } from "../src/node/compile.js";
import { documentationClassification, loadConfig } from "../src/node/config.js";
import { isExcludedPath } from "../src/core/classify.js";
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

  it("points View source at the in-site browser even when a repository is configured", async () => {
    const dir = new URL("../fixtures/options", import.meta.url).pathname;
    const compiled = await compileInput(dir);
    const registry = loadRegistryFromBytes(compiled.bytes);
    const fileName = "options.proto";
    const model = buildModel(registry, {
      title: "test",
      inputLabel: dir,
      classification: {},
      source: { repository: "github:acme/apis", commit: "deadbeef" },
      sourceTexts: { [fileName]: 'syntax = "proto3";\n' },
    });
    const message = model.messages.find((item) => item.fullName === "fixtures.options.Item");
    expect(message?.sourceLink?.url).toMatch(/^\/source\/options\.proto\/#L\d+$/);
    expect(message?.sourceLink?.url).not.toContain("github.com");
    expect(message?.repositoryLink?.url).toBe(
      "https://github.com/acme/apis/blob/deadbeef/options.proto#L" +
        (message?.source?.startLine ?? 1),
    );
  });

  it("publishes a page for a field anchor and for types linked from that page", async () => {
    const dir = new URL("../examples/acme", import.meta.url).pathname;
    const compiled = await compileInput(dir);
    const registry = loadRegistryFromBytes(compiled.bytes);
    const model = buildModel(registry, {
      title: "Acme",
      inputLabel: dir,
      classification: {
        include: ["acme/**"],
        exclude: ["google/api/**", "buf/validate/**", "cybozu/validate/**"],
      },
    });
    const http = model.messages.find((item) => item.fullName === "google.api.Http");
    const rules = model.fields.find((item) => item.fullName === "google.api.Http.rules");
    expect(http?.generatePage).toBe(false);
    expect(rules?.anchor).toBe("rules");
    expect(rules?.generatePage).toBe(false);
    const stringRules = model.messages.find((item) => item.fullName === "buf.validate.StringRules");
    expect(stringRules?.generatePage).toBe(false);
    const custom = model.messages.find((item) => item.fullName === "google.api.CustomHttpPattern");
    expect(custom?.generatePage).toBe(false);
    const getUser = model.methods.find((item) => item.fullName === "acme.user.v1.UserService.GetUser");
    expect(getUser?.generatePage).toBe(true);
    expect(getUser?.inNav).toBe(false);
    expect(getUser?.anchor).toBeUndefined();
    expect(getUser?.urlPath).toBe("/reference/methods/acme.user.v1.UserService.GetUser/");
    const email = model.fields.find((item) => item.fullName === "acme.user.v1.User.email");
    expect(email?.urlPath).toBe("/reference/messages/acme.user.v1.User/");
    expect(model.symbolIndex.find((item) => item.fullName === "acme.user.v1.UserService.GetUser")?.urlPath).toBe(
      "/reference/methods/acme.user.v1.UserService.GetUser/",
    );
  });

  it("drops pages and links for files matched by documentation.exclude", async () => {
    const dir = new URL("../examples/acme", import.meta.url).pathname;
    const { config } = loadConfig(dir);
    const exclude = config.documentation?.exclude;
    expect(exclude).toEqual(["google/api/**", "buf/validate/**", "cybozu/validate/**"]);
    const compiled = await compileInput(dir);
    const registry = loadRegistryFromBytes(compiled.bytes);
    const model = buildModel(registry, {
      title: config.title,
      inputLabel: dir,
      classification: documentationClassification(config),
      sourceTexts: {
        "google/api/http.proto": 'syntax = "proto3";\n',
        "acme/user/v1/user.proto": 'syntax = "proto3";\n',
      },
    });

    const excluded = Object.values(model.symbols).filter((symbol) =>
      isExcludedPath(symbol.fileName, symbol.packageName, exclude),
    );
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded.filter((symbol) => symbol.generatePage).map((symbol) => symbol.fullName)).toEqual([]);
    const excludedIds = new Set(excluded.map((symbol) => symbol.id));
    for (const pkg of model.packages) {
      if (pkg.fileIds.length > 0 && pkg.fileIds.every((id) => excludedIds.has(id))) {
        excludedIds.add(pkg.id);
        expect(pkg.generatePage, pkg.fullName).toBe(false);
      }
    }
    expect(model.symbolIndex.filter((entry) => excludedIds.has(entry.id))).toEqual([]);
    const linked = Object.values(model.symbols).flatMap((symbol) =>
      [...symbol.references, ...symbol.referencedBy].flatMap((ref) => {
        const endpoints = [ref.fromId, ref.toId].filter((id) => excludedIds.has(id));
        return endpoints.map((id) => `${symbol.fullName} ${ref.kind} ${id}`);
      }),
    );
    expect(linked).toEqual([]);

    for (const file of model.files) {
      if (excludedIds.has(file.id)) {
        expect(file.dependencyIds, file.fullName).toEqual([]);
        expect(file.sourceText, file.fullName).toBeUndefined();
        expect(file.generatePage, file.fullName).toBe(false);
      } else {
        expect(file.dependencyIds.filter((id) => excludedIds.has(id)), file.fullName).toEqual([]);
      }
    }
    expect(model.files.find((file) => file.fullName === "acme/user/v1/user.proto")?.sourceText).toContain("syntax");

    const email = model.fields.find((item) => item.fullName === "acme.user.v1.User.email");
    expect(email?.options.some((option) => option.semantic?.rendererId === "validation" && option.definitionId === undefined)).toBe(
      true,
    );
    const getUser = model.methods.find((item) => item.fullName === "acme.user.v1.UserService.GetUser");
    expect(getUser?.options.some((option) => option.semantic?.rendererId === "google.api.http" && option.definitionId === undefined)).toBe(
      true,
    );
    const flagId = model.fields.find((item) => item.fullName === "acme.experiment.v1.Flag.id");
    expect(
      flagId?.options.some((option) => option.semantic?.rendererId === "cybozu.validate" && option.definitionId === undefined),
    ).toBe(true);
    expect(model.messages.find((item) => item.fullName === "acme.user.v1.User")?.generatePage).toBe(true);
    expect(getUser?.generatePage).toBe(true);
  });

  it("resolves dependency CLIs even when package.json is not exported", async () => {
    const { resolveNpmBin } = await import("../src/node/compile.js");
    const { existsSync } = await import("node:fs");
    expect(existsSync(resolveNpmBin("astro", "astro"))).toBe(true);
    expect(existsSync(resolveNpmBin("pagefind", "pagefind"))).toBe(true);
  });
});
