import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyFile, isExcludedPath, resolveExternalUrl } from "./core/classify.js";
import { repositoryBlobUrl } from "./core/urls.js";
import type { SchemaModel } from "./core/types.js";
import { program } from "./cli.js";
import { ConfigSchema, documentationClassification, loadConfig, type PbSchemaLensConfig } from "./node/config.js";
import { fullTextEnabled, siteBuildEnv, writeArtifacts } from "./node/generate-site.js";
import { documentationSource, loadPlugins, sourceBrowserEnabled } from "./node/pipeline.js";
import { resolveRuntime } from "./node/runtime.js";
import { canonicalHref, configuredBase, withBase } from "../site/src/lib/data.ts";

const flippedYaml = `title: "Flipped Title"
input: "examples/acme"
output: "custom-dist"
base: "/docs/"
siteUrl: "https://example.com"
source:
  repository: "github:acme/apis"
  commit: "abc123"
documentation:
  include:
    - "acme/user/**"
  exclude:
    - "google/api/**"
    - "buf/validate/**"
    - "cybozu/validate/**"
wellKnownTypes:
  enabled: false
search:
  fullText: false
sourceBrowser:
  enabled: false
artifacts:
  descriptorSet: true
  references: false
externalLinks:
  - package: "acme.billing.v1.**"
    urlTemplate: "https://docs.example.com/billing/{symbol}"
plugins:
  - "./flip-plugin.mjs"
`;

let dir: string;
let configPath: string;
let config: PbSchemaLensConfig;

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    const type = "_zod" in current ? current._zod.def.type : undefined;
    if (type === "optional" || type === "default" || type === "nullable" || type === "prefault") {
      current = current.unwrap();
      continue;
    }
    return current;
  }
}

function configLeaves(schema: z.ZodType = ConfigSchema, prefix = ""): string[] {
  const inner = unwrap(schema);
  const type = "_zod" in inner ? inner._zod.def.type : undefined;
  if (type === "array") {
    return prefix ? [prefix] : [];
  }
  if (!("shape" in inner) || typeof inner.shape !== "object" || inner.shape === null) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(inner.shape as Record<string, z.ZodType>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return configLeaves(child, path);
  });
}

function stubModel(): SchemaModel {
  return {
    symbolIndex: [
      {
        id: "message:pkg.Msg",
        name: "Msg",
        fullName: "pkg.Msg",
        kind: "message",
        package: "pkg",
        urlPath: "/reference/messages/pkg.Msg/",
      },
    ],
    symbols: {
      "message:pkg.Msg": { references: [{ fromId: "a", toId: "b", kind: "field-type" }] },
    },
    buildInfo: {
      title: "t",
      generatedAt: "2026-09-24T00:00:00.000Z",
      generator: "pbschema-lens",
      input: ".",
      symbolCount: 1,
      fileCount: 0,
      timings: {},
      warnings: [],
    },
  } as SchemaModel;
}

function withBaseEnv(value: string | undefined, run: () => void): void {
  const previous = process.env.PBSCHEMA_LENS_BASE;
  if (value === undefined) {
    delete process.env.PBSCHEMA_LENS_BASE;
  } else {
    process.env.PBSCHEMA_LENS_BASE = value;
  }
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env.PBSCHEMA_LENS_BASE;
    } else {
      process.env.PBSCHEMA_LENS_BASE = previous;
    }
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pbschema-lens-flags-"));
  configPath = join(dir, "pbschema-lens.yaml");
  await writeFile(configPath, flippedYaml);
  await writeFile(
    join(dir, "flip-plugin.mjs"),
    `export default {
  name: "flip",
  modelTransforms: [{
    name: "flip",
    transform(model) {
      model.buildInfo.warnings.push("flip-plugin");
      return model;
    },
  }],
};
`,
  );
  config = loadConfig(dir).config;
});

const checks: Record<string, () => Promise<void> | void> = {
  title() {
    expect(config.title).toBe("Flipped Title");
    const resolved = resolveRuntime(dir, undefined, { config: configPath });
    expect(resolved.config.title).toBe("Flipped Title");
    const overridden = resolveRuntime(dir, undefined, { config: configPath, title: "CLI Title" });
    expect(overridden.config.title).toBe("CLI Title");
  },
  input() {
    const resolved = resolveRuntime(dir, undefined, { config: configPath });
    expect(resolved.input).toBe(join(dir, "examples/acme"));
    const overridden = resolveRuntime(dir, "/tmp/acme", { config: configPath });
    expect(overridden.input).toBe("/tmp/acme");
  },
  output() {
    const resolved = resolveRuntime(dir, undefined, { config: configPath });
    expect(resolved.outDir).toBe(join(dir, "custom-dist"));
    const overridden = resolveRuntime(dir, undefined, { config: configPath, out: "cli-out" });
    expect(overridden.outDir).toBe(join(dir, "cli-out"));
  },
  base() {
    expect(config.base).toBe("/docs/");
    expect(siteBuildEnv(config, "/out", "/data/generated.json").PBSCHEMA_LENS_BASE).toBe("/docs/");
    withBaseEnv("/docs/", () => {
      expect(configuredBase()).toBe("/docs/");
      expect(withBase("/explore/")).toBe("/docs/explore/");
    });
    withBaseEnv("/docs", () => {
      expect(withBase("/explore/")).toBe("/docs/explore/");
    });
    withBaseEnv("/", () => {
      expect(configuredBase()).toBe("/");
      expect(withBase("/explore/")).toBe("/explore/");
    });
    const overridden = resolveRuntime(dir, undefined, { config: configPath, base: "/other/" });
    expect(overridden.config.base).toBe("/other/");
  },
  siteUrl() {
    expect(config.siteUrl).toBe("https://example.com");
    expect(siteBuildEnv(config, "/out", "/data/generated.json").PBSCHEMA_LENS_SITE_URL).toBe("https://example.com");
    expect(canonicalHref("https://example.com", "/docs/")).toBe("https://example.com/docs/");
    expect(canonicalHref(undefined, "/docs/")).toBeUndefined();
  },
  "source.repository"() {
    const source = documentationSource(config, "gitsha");
    expect(source.repository).toBe("github:acme/apis");
    expect(repositoryBlobUrl(source, "acme/user/v1/user.proto", 4)).toBe(
      "https://github.com/acme/apis/blob/abc123/acme/user/v1/user.proto#L4",
    );
  },
  "source.commit"() {
    expect(documentationSource(config, "gitsha").commit).toBe("abc123");
    const inherited = documentationSource({ ...config, source: { repository: "github:acme/apis" } }, "gitsha");
    expect(inherited.commit).toBe("gitsha");
    expect(repositoryBlobUrl(inherited, "acme/user/v1/user.proto", 4)).toBe(
      "https://github.com/acme/apis/blob/gitsha/acme/user/v1/user.proto#L4",
    );
  },
  async "source.urlTemplate"() {
    const templateDir = await mkdtemp(join(tmpdir(), "pbschema-lens-source-"));
    await writeFile(
      join(templateDir, "pbschema-lens.yaml"),
      `source:
  commit: "abc123"
  urlTemplate: "https://src.example/{commit}/{file}#L{line}"
`,
    );
    const source = documentationSource(loadConfig(templateDir).config);
    expect(repositoryBlobUrl(source, "acme/user/v1/user.proto", 9)).toBe(
      "https://src.example/abc123/acme/user/v1/user.proto#L9",
    );
  },
  "documentation.include"() {
    const classification = documentationClassification(config);
    expect(classification.include).toEqual(["acme/user/**"]);
    expect(classifyFile("acme/user/v1/user.proto", "acme.user.v1", classification)).toMatchObject({
      domain: "local",
      generatePage: true,
      inNav: true,
    });
    expect(classifyFile("acme/experiment/v1/flags.proto", "acme.experiment.v1", classification)).toMatchObject({
      domain: "external-undocumented",
      generatePage: false,
      inNav: false,
    });
  },
  "documentation.exclude"() {
    const classification = documentationClassification(config);
    expect(classification.exclude).toEqual(["google/api/**", "buf/validate/**", "cybozu/validate/**"]);
    expect(isExcludedPath("google/api/http.proto", "google.api", classification.exclude)).toBe(true);
    expect(classifyFile("google/api/http.proto", "google.api", classification)).toMatchObject({
      domain: "external-undocumented",
      generatePage: false,
      inNav: false,
    });
    expect(classifyFile("buf/validate/validate.proto", "buf.validate", classification).generatePage).toBe(false);
    expect(classifyFile("cybozu/validate/validate.proto", "cybozu.validate", classification).generatePage).toBe(false);
    expect(classifyFile("acme/user/v1/user.proto", "acme.user.v1", classification).generatePage).toBe(true);
  },
  "wellKnownTypes.enabled"() {
    const hidden = documentationClassification(config);
    expect(hidden.wellKnownTypes).toBe(false);
    expect(classifyFile("google/protobuf/timestamp.proto", "google.protobuf", hidden)).toEqual({
      domain: "well-known",
      generatePage: false,
      inNav: false,
    });
    const shown = documentationClassification({ ...config, wellKnownTypes: undefined });
    expect(shown.wellKnownTypes).toBe(true);
    expect(classifyFile("google/protobuf/timestamp.proto", "google.protobuf", shown).generatePage).toBe(true);
    expect(classifyFile("google/protobuf/descriptor.proto", "google.protobuf", shown)).toMatchObject({
      domain: "well-known",
      generatePage: false,
      inNav: false,
    });
    const explicit = documentationClassification({ ...config, wellKnownTypes: { enabled: true } });
    expect(explicit.wellKnownTypes).toBe(true);
  },
  "search.fullText"() {
    expect(config.search?.fullText).toBe(false);
    expect(fullTextEnabled(config)).toBe(false);
    expect(fullTextEnabled(ConfigSchema.parse({}))).toBe(true);
    expect(fullTextEnabled(ConfigSchema.parse({ search: { fullText: true } }))).toBe(true);
  },
  "sourceBrowser.enabled"() {
    expect(config.sourceBrowser?.enabled).toBe(false);
    expect(sourceBrowserEnabled(config)).toBe(false);
    expect(sourceBrowserEnabled(ConfigSchema.parse({}))).toBe(true);
    expect(sourceBrowserEnabled(ConfigSchema.parse({ sourceBrowser: { enabled: true } }))).toBe(true);
  },
  async "artifacts.descriptorSet"() {
    const out = join(dir, "descriptor-out");
    await writeArtifacts(out, {
      model: stubModel(),
      outDir: out,
      config,
      descriptorBytes: new Uint8Array([1, 2, 3]),
      timings: {},
    });
    expect(existsSync(join(out, "assets/protobuf/schema.binpb"))).toBe(true);
    const skipped = join(dir, "descriptor-skipped");
    await writeArtifacts(skipped, {
      model: stubModel(),
      outDir: skipped,
      config: ConfigSchema.parse({ artifacts: { descriptorSet: false } }),
      descriptorBytes: new Uint8Array([1, 2, 3]),
      timings: {},
    });
    expect(existsSync(join(skipped, "assets/protobuf/schema.binpb"))).toBe(false);
    expect(existsSync(join(skipped, "assets/protobuf/symbols.json"))).toBe(true);
  },
  async "artifacts.references"() {
    const out = join(dir, "references-out");
    await writeArtifacts(out, { model: stubModel(), outDir: out, config, timings: {} });
    expect(existsSync(join(out, "assets/protobuf/references.json"))).toBe(false);
    expect(existsSync(join(out, "assets/protobuf/symbols.json"))).toBe(true);
    expect(existsSync(join(out, "assets/protobuf/build-info.json"))).toBe(true);
    const kept = join(dir, "references-kept");
    await writeArtifacts(kept, {
      model: stubModel(),
      outDir: kept,
      config: ConfigSchema.parse({ artifacts: { references: true } }),
      timings: {},
    });
    const refs = JSON.parse(await readFile(join(kept, "assets/protobuf/references.json"), "utf8")) as unknown[];
    expect(refs).toHaveLength(1);
  },
  externalLinks() {
    const classification = documentationClassification(config);
    expect(classifyFile("acme/billing/v1/invoice.proto", "acme.billing.v1", classification)).toMatchObject({
      domain: "external-documented",
      generatePage: false,
      inNav: false,
    });
    expect(resolveExternalUrl("acme.billing.v1.Invoice", "message", classification)).toBe(
      "https://docs.example.com/billing/acme.billing.v1.Invoice",
    );
  },
  async plugins() {
    const plugins = await loadPlugins(config.plugins ?? [], dir);
    const model = stubModel();
    const transform = plugins[0]?.modelTransforms?.[0];
    expect(transform).toBeTruthy();
    transform?.transform(model);
    expect(model.buildInfo.warnings).toContain("flip-plugin");
  },
};

function longOptions(commandName: string): string[] {
  const command = program.commands.find((item) => item.name() === commandName);
  if (!command) {
    throw new Error(`missing command ${commandName}`);
  }
  return command.options.map((option) => option.long ?? "");
}

describe("config flags", () => {
  it.each(Object.keys(checks))("%s is read by the function that implements it", async (leaf) => {
    await checks[leaf]();
  });

  it("build, dev, and diff all declare --base and --title", () => {
    for (const command of ["build", "dev", "diff"]) {
      expect(longOptions(command), command).toEqual(expect.arrayContaining(["--base", "--title"]));
    }
  });

  it("fails when a config key has no flip test", () => {
    expect(configLeaves().sort()).toEqual(Object.keys(checks).sort());
  });
});
