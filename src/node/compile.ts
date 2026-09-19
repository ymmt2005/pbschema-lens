import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type InputKind = "buf" | "proto-dir" | "descriptor-set";

export interface CompiledSchema {
  bytes: Uint8Array;
  kind: InputKind;
  workDir: string;
  localFiles: string[];
  bufAvailable: boolean;
}

const DESCRIPTOR_EXTS = new Set([".binpb", ".pb", ".desc", ".fds"]);

export function detectInput(input: string): InputKind {
  const abs = resolve(input);
  if (existsSync(abs) && statSync(abs).isFile() && DESCRIPTOR_EXTS.has(extname(abs))) {
    return "descriptor-set";
  }
  if (existsSync(join(abs, "buf.yaml")) || existsSync(join(abs, "buf.yml"))) {
    return "buf";
  }
  return "proto-dir";
}

export async function compileInput(input: string): Promise<CompiledSchema> {
  const abs = resolve(input);
  const kind = detectInput(abs);
  if (kind === "descriptor-set") {
    return {
      bytes: await readFile(abs),
      kind,
      workDir: dirname(abs),
      localFiles: [],
      bufAvailable: Boolean(resolveBufBin()),
    };
  }
  const workDir = kind === "buf" ? abs : await materializeBufWorkspace(abs);
  const out = join(await mkdtemp(join(tmpdir(), "pbschema-lens-")), "schema.binpb");
  await runBuf(workDir, ["build", "--as-file-descriptor-set", "-o", out]);
  const localFiles = await listProtoFiles(kind === "buf" ? abs : abs);
  return {
    bytes: await readFile(out),
    kind,
    workDir,
    localFiles,
    bufAvailable: true,
  };
}

export function resolveBufBin(): string | undefined {
  const require = createRequire(import.meta.url);
  try {
    const pkg = dirname(require.resolve("@bufbuild/buf/package.json"));
    const bin = join(pkg, "bin/buf");
    if (existsSync(bin)) {
      return bin;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function runBuf(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = resolveBufBin() ?? "buf";
  return run(bin, args, cwd);
}

/** Resolve a dependency CLI whether npm hoisted it or nested it under this package. */
export function resolveNpmBin(pkgName: string, binName: string): string {
  const require = createRequire(import.meta.url);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  } catch {
    pkgJsonPath = join(findPackageRoot(require.resolve(pkgName), pkgName), "package.json");
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!rel) {
    throw new Error(`${pkgName} has no bin named ${binName}`);
  }
  return join(dirname(pkgJsonPath), rel);
}

function findPackageRoot(fromFile: string, pkgName: string): string {
  let dir = dirname(fromFile);
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
      if (pkg.name === pkgName) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot find package root for ${pkgName}`);
    }
    dir = parent;
  }
}

async function materializeBufWorkspace(protoDir: string): Promise<string> {
  const abs = resolve(protoDir);
  if (existsSync(join(abs, "buf.yaml"))) {
    return abs;
  }
  const temp = await mkdtemp(join(tmpdir(), "pbschema-lens-mod-"));
  const yaml = `version: v2\nmodules:\n  - path: proto\n`;
  await writeFile(join(temp, "buf.yaml"), yaml);
  const protoRoot = join(temp, "proto");
  await mkdir(protoRoot, { recursive: true });
  await cpProtoTree(abs, protoRoot);
  return temp;
}

async function cpProtoTree(from: string, to: string): Promise<void> {
  const { cp } = await import("node:fs/promises");
  await cp(from, to, {
    recursive: true,
    filter: (source) => {
      const stats = statSync(source);
      if (stats.isDirectory()) {
        return true;
      }
      return source.endsWith(".proto");
    },
  });
}

export async function listProtoFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, root, files);
  return files.sort();
}

async function walk(root: string, dir: string, files: string[]): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      await walk(root, path, files);
    } else if (entry.name.endsWith(".proto")) {
      files.push(path.slice(root.length + 1).replaceAll("\\", "/"));
    }
  }
}

function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr || stdout}`));
      }
    });
  });
}

export function packageRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const fromHere = resolve(here, "../..");
  if (existsSync(join(fromHere, "site/astro.config.mjs"))) {
    return fromHere;
  }
  return resolve(here, "../../..");
}
