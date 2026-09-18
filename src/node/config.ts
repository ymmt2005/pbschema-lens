import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ExternalLinkSchema = z.object({
  package: z.string(),
  urlTemplate: z.string(),
});

export const ConfigSchema = z.object({
  title: z.string().default("Protobuf API"),
  input: z.string().default("."),
  output: z.string().default("dist"),
  base: z.string().default("/"),
  siteUrl: z.string().optional(),
  source: z
    .object({
      repository: z.string().optional(),
      commit: z.string().optional(),
      urlTemplate: z.string().optional(),
    })
    .optional(),
  documentation: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  wellKnownTypes: z.object({ enabled: z.boolean().default(true) }).optional(),
  search: z
    .object({
      symbolIndex: z.boolean().default(true),
      fullText: z.boolean().default(true),
    })
    .optional(),
  sourceBrowser: z.object({ enabled: z.boolean().default(true) }).optional(),
  artifacts: z
    .object({
      descriptorSet: z.boolean().default(false),
      symbolIndex: z.boolean().default(true),
      references: z.boolean().default(true),
    })
    .optional(),
  externalLinks: z.array(ExternalLinkSchema).optional(),
  plugins: z.array(z.string()).optional(),
  playground: z.boolean().default(false),
});

export type PbSchemaLensConfig = z.infer<typeof ConfigSchema>;

export const CONFIG_FILENAMES = ["pbschema-lens.yaml", "pbschema-lens.yml"];

export function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

export function loadConfig(cwd: string, explicit?: string, extraDirs: string[] = []): { path?: string; config: PbSchemaLensConfig } {
  const path = explicit
    ? resolve(cwd, explicit)
    : extraDirs.concat(cwd).map(findConfigFile).find(Boolean);
  if (!path) {
    return { config: ConfigSchema.parse({}) };
  }
  const raw = parseYaml(readFileSync(path, "utf8")) ?? {};
  return { path, config: ConfigSchema.parse(raw) };
}

export function configDir(path: string | undefined, cwd: string): string {
  return path ? dirname(path) : cwd;
}
