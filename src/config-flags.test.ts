import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { isExcludedPath } from "./core/classify.js";
import { buildModel } from "./core/model.js";
import { loadRegistryFromBytes } from "./core/registry.js";
import type { SchemaModel } from "./core/types.js";
import { compileInput } from "./node/compile.js";
import { ConfigSchema, loadConfig, type PbSchemaLensConfig } from "./node/config.js";
import { buildDocumentation, documentationSource } from "./node/pipeline.js";
import { resolveRuntime } from "./node/runtime.js";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("..", import.meta.url).pathname;
const acmeDir = new URL("../examples/acme", import.meta.url).pathname;

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

interface Fixture {
  dir: string;
  configPath: string;
  config: PbSchemaLensConfig;
  outDir: string;
  model: SchemaModel;
  html: string;
  symbols: Array<{ fullName: string }>;
  help: Record<"build" | "dev" | "diff", string>;
}

let fx: Fixture;

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

export function configLeaves(schema: z.ZodType = ConfigSchema, prefix = ""): string[] {
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

async function commandHelp(command: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), join(repoRoot, "src/cli.ts"), command, "--help"],
    { cwd: repoRoot },
  );
  return `${stdout}\n${stderr}`;
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbschema-lens-flags-"));
  const configPath = join(dir, "pbschema-lens.yaml");
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
  const { config } = loadConfig(dir);
  const outDir = join(dir, "out");
  const [model, buildHelp, devHelp, diffHelp] = await Promise.all([
    buildDocumentation({ input: acmeDir, outDir, config, cwd: dir }),
    commandHelp("build"),
    commandHelp("dev"),
    commandHelp("diff"),
  ]);
  const html = await readFile(join(outDir, "index.html"), "utf8");
  const symbols = JSON.parse(await readFile(join(outDir, "assets/protobuf/symbols.json"), "utf8")) as Array<{
    fullName: string;
  }>;
  fx = { dir, configPath, config, outDir, model, html, symbols, help: { build: buildHelp, dev: devHelp, diff: diffHelp } };
}, 60_000);

const checks: Record<string, () => Promise<void> | void> = {
  async title() {
    expect(fx.model.title).toBe("Flipped Title");
    expect(fx.model.buildInfo.title).toBe("Flipped Title");
    expect(fx.html).toContain("Flipped Title");
  },
  input() {
    const resolved = resolveRuntime(fx.dir, undefined, { config: fx.configPath });
    expect(resolved.input).toBe(join(fx.dir, "examples/acme"));
    const overridden = resolveRuntime(fx.dir, acmeDir, { config: fx.configPath });
    expect(overridden.input).toBe(acmeDir);
  },
  output() {
    const resolved = resolveRuntime(fx.dir, undefined, { config: fx.configPath });
    expect(resolved.outDir).toBe(join(fx.dir, "custom-dist"));
    const overridden = resolveRuntime(fx.dir, undefined, { config: fx.configPath, out: "cli-out" });
    expect(overridden.outDir).toBe(join(fx.dir, "cli-out"));
  },
  base() {
    expect(fx.config.base).toBe("/docs/");
    expect(fx.html).toContain('href="/docs/explore/"');
    const overridden = resolveRuntime(fx.dir, undefined, { config: fx.configPath, base: "/other/" });
    expect(overridden.config.base).toBe("/other/");
  },
  siteUrl() {
    expect(fx.html).toContain('<link rel="canonical" href="https://example.com/docs/');
  },
  "source.repository"() {
    const user = fx.model.messages.find((item) => item.fullName === "acme.user.v1.User");
    expect(user?.sourceLink?.url).toContain("https://github.com/acme/apis/blob/abc123/acme/user/v1/user.proto#L");
  },
  "source.commit"() {
    const user = fx.model.messages.find((item) => item.fullName === "acme.user.v1.User");
    expect(user?.sourceLink?.url).toContain("/abc123/");
  },
  async "source.urlTemplate"() {
    const compiled = await compileInput(acmeDir);
    const registry = loadRegistryFromBytes(compiled.bytes);
    const dir = await mkdtemp(join(tmpdir(), "pbschema-lens-source-"));
    await writeFile(
      join(dir, "pbschema-lens.yaml"),
      `source:
  commit: "abc123"
  urlTemplate: "https://src.example/{commit}/{file}#L{line}"
`,
    );
    const { config } = loadConfig(dir);
    const model = buildModel(registry, {
      title: "t",
      inputLabel: acmeDir,
      classification: {},
      source: documentationSource(config),
      sourceTexts: { "acme/user/v1/user.proto": 'syntax = "proto3";\n' },
    });
    const user = model.messages.find((item) => item.fullName === "acme.user.v1.User");
    expect(user?.repositoryLink?.url).toMatch(/^https:\/\/src\.example\/abc123\/acme\/user\/v1\/user\.proto#L\d+$/);
    expect(user?.sourceLink?.url).toMatch(/^\/source\/acme\/user\/v1\/user\.proto\/#L\d+$/);
  },
  "documentation.include"() {
    expect(fx.model.messages.find((item) => item.fullName === "acme.user.v1.User")?.generatePage).toBe(true);
    const flag = fx.model.messages.find((item) => item.fullName === "acme.experiment.v1.Flag");
    expect(flag?.domain).toBe("external-undocumented");
    expect(flag?.generatePage).toBe(false);
    expect(flag?.inNav).toBe(false);
    expect(fx.model.symbolIndex.some((entry) => entry.fullName === "acme.experiment.v1.Flag")).toBe(false);
  },
  "documentation.exclude"() {
    const excluded = Object.values(fx.model.symbols).filter((symbol) =>
      isExcludedPath(symbol.fileName, symbol.packageName, fx.config.documentation?.exclude),
    );
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded.filter((symbol) => symbol.generatePage).map((symbol) => symbol.fullName)).toEqual([]);
    const excludedIds = new Set(excluded.map((symbol) => symbol.id));
    expect(fx.symbols.filter((entry) => excluded.some((symbol) => symbol.fullName === entry.fullName && symbol.kind !== "package"))).toEqual(
      [],
    );
    expect(fx.model.symbolIndex.filter((entry) => excludedIds.has(entry.id))).toEqual([]);
    for (const file of fx.model.files) {
      if (!excludedIds.has(file.id)) continue;
      expect(file.sourceText, file.fullName).toBeUndefined();
      expect(file.dependencyIds, file.fullName).toEqual([]);
      expect(existsSync(join(fx.outDir, "source", file.fullName, "index.html")), file.fullName).toBe(false);
    }
    const linked = Object.values(fx.model.symbols).flatMap((symbol) =>
      [...symbol.references, ...symbol.referencedBy].filter((ref) => excludedIds.has(ref.fromId) || excludedIds.has(ref.toId)),
    );
    expect(linked).toEqual([]);
    const getUser = fx.model.methods.find((item) => item.fullName === "acme.user.v1.UserService.GetUser");
    expect(getUser?.options.some((option) => option.semantic?.rendererId === "google.api.http" && option.definitionId === undefined)).toBe(
      true,
    );
  },
  "wellKnownTypes.enabled"() {
    const timestamp = fx.model.messages.find((item) => item.fullName === "google.protobuf.Timestamp");
    expect(timestamp?.domain).toBe("well-known");
    expect(timestamp?.generatePage).toBe(false);
    expect(timestamp?.inNav).toBe(false);
    expect(fx.model.packages.find((item) => item.fullName === "google.protobuf")?.generatePage).toBe(false);
    const created = fx.model.fields.find((item) => item.fullName === "acme.user.v1.User.created_at");
    expect(created?.type.name).toBe("google.protobuf.Timestamp");
    expect(created?.type.urlPath).toBeUndefined();
    expect(fx.symbols.some((entry) => entry.fullName === "google.protobuf.Timestamp")).toBe(false);
    expect(fx.html).not.toContain("Protobuf standard library");
    expect(existsSync(join(fx.outDir, "reference/messages/google.protobuf.Timestamp/index.html"))).toBe(false);
  },
  "search.fullText"() {
    expect(existsSync(join(fx.outDir, "pagefind"))).toBe(false);
    expect(fx.model.buildInfo.timings["search-indexing"]).toBeUndefined();
    expect(fx.symbols.some((entry) => entry.fullName === "acme.user.v1.User")).toBe(true);
  },
  "sourceBrowser.enabled"() {
    const file = fx.model.files.find((item) => item.fullName === "acme/user/v1/user.proto");
    expect(file?.sourceText).toBeUndefined();
    expect(file?.generatePage).toBe(false);
    expect(existsSync(join(fx.outDir, "source/acme/user/v1/user.proto/index.html"))).toBe(false);
    expect(fx.html).not.toContain('href="/docs/source/"');
  },
  "artifacts.descriptorSet"() {
    const bytes = existsSync(join(fx.outDir, "assets/protobuf/schema.binpb"));
    expect(bytes).toBe(true);
  },
  "artifacts.references"() {
    expect(existsSync(join(fx.outDir, "assets/protobuf/references.json"))).toBe(false);
    expect(existsSync(join(fx.outDir, "assets/protobuf/build-info.json"))).toBe(true);
    expect(existsSync(join(fx.outDir, "assets/protobuf/symbols.json"))).toBe(true);
  },
  externalLinks() {
    const invoice = fx.model.messages.find((item) => item.fullName === "acme.billing.v1.Invoice");
    expect(invoice?.domain).toBe("external-documented");
    expect(invoice?.generatePage).toBe(false);
    const field = fx.model.fields.find((item) => item.fullName === "acme.billing.v1.GetInvoiceResponse.invoice");
    expect(field?.type.externalUrl).toBe("https://docs.example.com/billing/acme.billing.v1.Invoice");
    expect(field?.type.urlPath).toBeUndefined();
    expect(existsSync(join(fx.outDir, "reference/messages/acme.billing.v1.Invoice/index.html"))).toBe(false);
  },
  plugins() {
    expect(fx.model.buildInfo.warnings).toContain("flip-plugin");
  },
};

describe("config flags", () => {
  it.each(Object.keys(checks))("%s changes the build when flipped", async (leaf) => {
    await checks[leaf]();
  });

  it("build, dev, and diff all declare --base and --title", () => {
    for (const command of ["build", "dev", "diff"] as const) {
      expect(fx.help[command], command).toContain("--base");
      expect(fx.help[command], command).toContain("--title");
    }
    const titled = resolveRuntime(fx.dir, undefined, { config: fx.configPath, title: "CLI Title" });
    expect(titled.config.title).toBe("CLI Title");
  });

  it("fails when a config key has no flip test", () => {
    expect(configLeaves().sort()).toEqual(Object.keys(checks).sort());
  });
});
