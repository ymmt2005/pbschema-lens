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
  const path = process.env.PROTOLENS_DATA_FILE && existsSync(process.env.PROTOLENS_DATA_FILE)
    ? process.env.PROTOLENS_DATA_FILE
    : local;
  if (!existsSync(path)) {
    throw new Error(`Protolens model not found at ${path}. Run the CLI build first.`);
  }
  cache = JSON.parse(readFileSync(path, "utf8")) as SchemaModel;
  return cache;
}

export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!path.startsWith("/")) {
    return `${prefix}/${path}`;
  }
  return `${prefix}${path}`;
}
