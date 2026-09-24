import { dirname, resolve } from "node:path";
import { loadConfig, type PbSchemaLensConfig } from "./config.js";

export interface RuntimeFlags {
  config?: string;
  title?: string;
  base?: string;
  out?: string;
}

/** Shared by build, dev, and diff. A command only receives flags it declared. */
export function resolveRuntime(cwd: string, inputArg: string | undefined, flags: RuntimeFlags): {
  cwd: string;
  config: PbSchemaLensConfig;
  input: string;
  outDir: string;
} {
  const inputGuess = resolve(cwd, inputArg ?? ".");
  const loaded = loadConfig(cwd, flags.config, [inputGuess]);
  const config = loaded.config;
  if (flags.base) config.base = flags.base;
  if (flags.title) config.title = flags.title;
  const input = inputArg
    ? resolve(cwd, inputArg)
    : resolve(loaded.path ? dirname(loaded.path) : cwd, config.input ?? ".");
  const outDir = resolve(cwd, flags.out ?? config.output ?? "dist");
  return { cwd, config, input, outDir };
}
