import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildModel } from "../core/model.js";
import { loadRegistryFromBytes } from "../core/registry.js";
import { diffModels } from "../core/diff.js";
import type { PbSchemaLensPlugin, SchemaModel } from "../core/types.js";
import { collectBreaking } from "./breaking.js";
import { compileInput } from "./compile.js";
import { documentationClassification, type PbSchemaLensConfig } from "./config.js";
import { generateSite } from "./generate-site.js";
import { detectGitInfo } from "./git.js";
import { loadSourceTexts } from "./sources.js";

export interface BuildOptions {
  input: string;
  outDir: string;
  config: PbSchemaLensConfig;
  against?: string;
  againstLabel?: string;
  cwd: string;
}

export async function buildDocumentation(options: BuildOptions): Promise<SchemaModel> {
  const timings: Record<string, number> = {};
  const mark = (name: string, start: number) => {
    timings[name] = Date.now() - start;
  };

  let start = Date.now();
  const compiled = await compileInput(options.input);
  mark("compile", start);

  start = Date.now();
  const registry = loadRegistryFromBytes(compiled.bytes);
  mark("descriptor-loading", start);

  const git = await detectGitInfo(compiled.workDir);
  const descriptorFiles = [...registry.files].map((file) => file.proto.name || `${file.name}.proto`);
  const sourceTexts = await collectSourceTexts(options.config, () =>
    loadSourceTexts(compiled.workDir, descriptorFiles),
  );

  const plugins = await loadPlugins(options.config.plugins ?? [], options.cwd);

  start = Date.now();
  let model = buildModel(registry, {
    title: options.config.title,
    inputLabel: options.input,
    classification: documentationClassification(options.config, new Set(Object.keys(sourceTexts))),
    source: documentationSource(options.config, git.commit),
    sourceTexts,
    plugins,
    timings,
    commit: git.commit,
  });
  mark("model-building", start);

  if (options.against) {
    start = Date.now();
    const previous = await compileInput(resolve(options.cwd, options.against));
    const prevRegistry = loadRegistryFromBytes(previous.bytes);
    const prevModel = buildModel(prevRegistry, {
      title: options.config.title,
      inputLabel: options.against,
      classification: documentationClassification(options.config, new Set(previous.localFiles)),
    });
    model.diff = diffModels(model, prevModel, options.againstLabel ?? options.against);
    if (compiled.kind === "buf") {
      try {
        model.diff.breaking = await collectBreaking(compiled.workDir, options.against, model);
      } catch {
        // optional
      }
    }
    mark("diff", start);
  }

  start = Date.now();
  await generateSite({
    model,
    outDir: options.outDir,
    config: options.config,
    descriptorBytes: options.config.artifacts?.descriptorSet ? compiled.bytes : undefined,
    timings,
  });
  mark("page-generation", start);
  model.buildInfo.timings = timings;
  await writeFile(join(options.outDir, "assets/protobuf/build-info.json"), JSON.stringify(model.buildInfo, null, 2));
  return model;
}

export function sourceBrowserEnabled(config: PbSchemaLensConfig): boolean {
  return config.sourceBrowser?.enabled !== false;
}

export async function collectSourceTexts(
  config: PbSchemaLensConfig,
  load: () => Promise<Record<string, string>>,
): Promise<Record<string, string>> {
  if (!sourceBrowserEnabled(config)) return {};
  return load();
}

export function documentationSource(config: PbSchemaLensConfig, gitCommit?: string): {
  repository?: string;
  commit?: string;
  urlTemplate?: string;
} {
  return {
    repository: config.source?.repository,
    commit: config.source?.commit ?? gitCommit,
    urlTemplate: config.source?.urlTemplate,
  };
}

async function loadPlugins(specs: string[], cwd: string): Promise<PbSchemaLensPlugin[]> {
  const plugins: PbSchemaLensPlugin[] = [];
  for (const spec of specs) {
    const url = spec.startsWith("file:") ? spec : pathToFileURL(resolve(cwd, spec)).href;
    const mod = (await import(url)) as { default?: PbSchemaLensPlugin; plugin?: PbSchemaLensPlugin };
    const plugin = mod.default ?? mod.plugin;
    if (!plugin) {
      throw new Error(`Plugin ${spec} did not export a plugin`);
    }
    plugins.push(plugin);
  }
  return plugins;
}
