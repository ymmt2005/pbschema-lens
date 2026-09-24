import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SchemaModel } from "../../../src/core/types.ts";

let cache: SchemaModel | undefined;

export function loadModel(): SchemaModel {
  if (cache) {
    return cache;
  }
  const local = join(dirname(fileURLToPath(import.meta.url)), "../data/generated.json");
  const path = process.env.PBSCHEMA_LENS_DATA_FILE && existsSync(process.env.PBSCHEMA_LENS_DATA_FILE)
    ? process.env.PBSCHEMA_LENS_DATA_FILE
    : local;
  if (!existsSync(path)) {
    throw new Error(`pbschema-lens model not found at ${path}. Run the CLI build first.`);
  }
  cache = JSON.parse(readFileSync(path, "utf8")) as SchemaModel;
  return cache;
}

/**
 * `import.meta.env.BASE_URL` is `/` while Astro is still prefixing built assets
 * with `base`. The CLI passes the configured base as PBSCHEMA_LENS_BASE.
 */
export function configuredBase(): string {
  const raw = process.env.PBSCHEMA_LENS_BASE || import.meta.env.BASE_URL || "/";
  if (!raw || raw === "/") return "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export function withBase(path: string): string {
  const base = configuredBase();
  if (base === "/") {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return path.startsWith("/") ? `${prefix}${path}` : `${prefix}/${path}`;
}
