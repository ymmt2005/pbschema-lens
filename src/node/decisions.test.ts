import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { invokedAsCli, program } from "../cli.js";
import type { SchemaModel } from "../core/types.js";
import { ConfigSchema } from "./config.js";
import { fullTextEnabled, siteBuildEnv, writeArtifacts } from "./generate-site.js";
import { collectSourceTexts, documentationSource, sourceBrowserEnabled } from "./pipeline.js";
import { resolveRuntime } from "./runtime.js";
import { repositoryBlobUrl } from "../core/urls.js";

function longOptions(commandName: string): string[] {
  const command = program.commands.find((item) => item.name() === commandName);
  if (!command) throw new Error(`missing command ${commandName}`);
  return command.options.map((option) => option.long ?? "");
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

describe("config decisions", () => {
  it("treats omitted search.fullText as on", () => {
    expect(fullTextEnabled(ConfigSchema.parse({}))).toBe(true);
    expect(fullTextEnabled(ConfigSchema.parse({ search: { fullText: false } }))).toBe(false);
  });

  it("skips source text when the source browser is off", async () => {
    expect(sourceBrowserEnabled(ConfigSchema.parse({}))).toBe(true);
    const off = ConfigSchema.parse({ sourceBrowser: { enabled: false } });
    expect(sourceBrowserEnabled(off)).toBe(false);
    let loaded = false;
    expect(await collectSourceTexts(off, async () => {
      loaded = true;
      return { "a.proto": "syntax" };
    })).toEqual({});
    expect(loaded).toBe(false);
    expect(await collectSourceTexts(ConfigSchema.parse({}), async () => ({ "a.proto": "syntax" }))).toEqual({
      "a.proto": "syntax",
    });
  });

  it("writes descriptor bytes and references only when those switches are on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pbschema-lens-artifacts-"));
    const on = join(dir, "on");
    await writeArtifacts(on, {
      model: stubModel(),
      outDir: on,
      config: ConfigSchema.parse({ artifacts: { descriptorSet: true, references: false } }),
      descriptorBytes: new Uint8Array([1, 2, 3]),
      timings: {},
    });
    expect(existsSync(join(on, "assets/protobuf/schema.binpb"))).toBe(true);
    expect(existsSync(join(on, "assets/protobuf/references.json"))).toBe(false);
    expect(existsSync(join(on, "assets/protobuf/symbols.json"))).toBe(true);
    expect(existsSync(join(on, "assets/protobuf/build-info.json"))).toBe(true);

    const off = join(dir, "off");
    await writeArtifacts(off, {
      model: stubModel(),
      outDir: off,
      config: ConfigSchema.parse({}),
      descriptorBytes: new Uint8Array([1, 2, 3]),
      timings: {},
    });
    expect(existsSync(join(off, "assets/protobuf/schema.binpb"))).toBe(false);
    const refs = JSON.parse(await readFile(join(off, "assets/protobuf/references.json"), "utf8")) as unknown[];
    expect(refs).toHaveLength(1);
  });

  it("passes base and siteUrl into the site build environment", () => {
    const env = siteBuildEnv(
      ConfigSchema.parse({ base: "/docs/", siteUrl: "https://example.com" }),
      "/out",
      "/data/generated.json",
    );
    expect(env.PBSCHEMA_LENS_BASE).toBe("/docs/");
    expect(env.PBSCHEMA_LENS_SITE_URL).toBe("https://example.com");
  });

  it("builds a repository link from source.commit and source.urlTemplate", () => {
    const config = ConfigSchema.parse({
      source: { commit: "abc123", urlTemplate: "https://src.example/{commit}/{file}#L{line}" },
    });
    expect(repositoryBlobUrl(documentationSource(config, "gitsha"), "acme/user/v1/user.proto", 9)).toBe(
      "https://src.example/abc123/acme/user/v1/user.proto#L9",
    );
    const inherited = documentationSource(ConfigSchema.parse({ source: { repository: "github:acme/apis" } }), "gitsha");
    expect(repositoryBlobUrl(inherited, "acme/user/v1/user.proto", 4)).toBe(
      "https://github.com/acme/apis/blob/gitsha/acme/user/v1/user.proto#L4",
    );
  });

  it("applies --base and --title on build, dev, and diff", async () => {
    for (const command of ["build", "dev", "diff"]) {
      expect(longOptions(command), command).toEqual(expect.arrayContaining(["--base", "--title"]));
    }
    const dir = await mkdtemp(join(tmpdir(), "pbschema-lens-runtime-"));
    await writeFile(join(dir, "pbschema-lens.yaml"), `title: "From yaml"\nbase: "/"\ninput: "examples/acme"\noutput: "custom-dist"\n`);
    const resolved = resolveRuntime(dir, undefined, { title: "CLI Title", base: "/docs/", out: "cli-out" });
    expect(resolved.config.title).toBe("CLI Title");
    expect(resolved.config.base).toBe("/docs/");
    expect(resolved.input).toBe(join(dir, "examples/acme"));
    expect(resolved.outDir).toBe(join(dir, "cli-out"));
  });

  it("treats a bin symlink as the CLI entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pbschema-lens-bin-"));
    const target = join(dir, "cli.js");
    const link = join(dir, "pbschema-lens");
    writeFileSync(target, "");
    symlinkSync(target, link);
    expect(invokedAsCli(pathToFileURL(target).href, link)).toBe(true);
    expect(invokedAsCli(pathToFileURL(target).href, join(dir, "other.js"))).toBe(false);
  });
});
