import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { SchemaModel } from "../core/types.js";
import { packageRoot } from "./compile.js";
import type { PbSchemaLensConfig } from "./config.js";

export interface GenerateSiteOptions {
  model: SchemaModel;
  outDir: string;
  config: PbSchemaLensConfig;
  descriptorBytes?: Uint8Array;
  timings: Record<string, number>;
}

export async function generateSite(options: GenerateSiteOptions): Promise<void> {
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const root = packageRoot();
  const siteRoot = join(root, "site");
  const dataFile = join(siteRoot, "src/data/generated.json");
  await mkdir(join(siteRoot, "src/data"), { recursive: true });
  await writeFile(dataFile, JSON.stringify(options.model));

  const start = Date.now();
  await runAstro(siteRoot, outDir, options.config);
  options.timings["astro-build"] = Date.now() - start;

  if (options.config.search?.fullText !== false) {
    const searchStart = Date.now();
    await runPagefind(outDir);
    options.timings["search-indexing"] = Date.now() - searchStart;
  }

  await writeArtifacts(outDir, options);
}

async function runAstro(siteRoot: string, outDir: string, config: PbSchemaLensConfig): Promise<void> {
  const env = {
    ...process.env,
    PBSCHEMA_LENS_OUT: outDir,
    PBSCHEMA_LENS_BASE: config.base || "/",
    PBSCHEMA_LENS_SITE_URL: config.siteUrl ?? "",
    PBSCHEMA_LENS_DATA_FILE: join(siteRoot, "src/data/generated.json"),
  };
  const bin = join(packageRoot(), "node_modules/.bin/astro");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(bin, ["build", "--root", siteRoot], {
      cwd: packageRoot(),
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`astro build failed with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function runPagefind(outDir: string): Promise<void> {
  const bin = join(packageRoot(), "node_modules/.bin/pagefind");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(bin, ["--site", outDir], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`pagefind failed with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function writeArtifacts(outDir: string, options: GenerateSiteOptions): Promise<void> {
  const dir = join(outDir, "assets/protobuf");
  await mkdir(dir, { recursive: true });
  if (options.config.artifacts?.symbolIndex !== false) {
    await writeFile(join(dir, "symbols.json"), JSON.stringify(options.model.symbolIndex, null, 2));
  }
  if (options.config.artifacts?.references !== false) {
    const refs = Object.values(options.model.symbols).flatMap((symbol) => symbol.references);
    await writeFile(join(dir, "references.json"), JSON.stringify(refs));
  }
  await writeFile(join(dir, "build-info.json"), JSON.stringify(options.model.buildInfo, null, 2));
  if (options.config.artifacts?.descriptorSet && options.descriptorBytes) {
    await writeFile(join(dir, "schema.binpb"), options.descriptorBytes);
  }
}
