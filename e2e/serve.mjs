// Builds the Acme example and serves it the way GitHub Pages does:
// a real file is returned as-is, and an unknown path returns 404.html.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(repo, "e2e/.site");
const bin = join(repo, "e2e/.bin/pbschema-lens");
const port = Number(process.env.E2E_PORT ?? 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function buildSite() {
  if (!existsSync(join(repo, "internal/site/dist/index.html"))) {
    run("npm", ["run", "build:ui"]);
  }
  mkdirSync(dirname(bin), { recursive: true });
  run("go", ["build", "-o", bin, "./cmd/pbschema-lens"]);
  const descriptor = spawnSync("buf", ["build", "examples/acme", "-o", "-", "--as-file-descriptor-set"], { cwd: repo });
  if (descriptor.error) throw descriptor.error;
  if (descriptor.status !== 0) {
    process.stderr.write(descriptor.stderr ?? "");
    process.exit(descriptor.status ?? 1);
  }
  const built = spawnSync(
    bin,
    ["build", "--config", "examples/acme/pbschema-lens.yaml", "--out", siteDir, "--source", "examples/acme/proto", "--base", "/"],
    { cwd: repo, input: descriptor.stdout, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (built.error) throw built.error;
  if (built.status !== 0) process.exit(built.status ?? 1);
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function resolveFile(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  const target = resolve(siteDir, `.${pathname}`);
  if (!inside(siteDir, target) || !existsSync(target)) return null;
  if (statSync(target).isDirectory()) {
    const index = join(target, "index.html");
    return existsSync(index) ? index : null;
  }
  return statSync(target).isFile() ? target : null;
}

buildSite();
const fallback = readFileSync(join(siteDir, "404.html"));

createServer((request, response) => {
  const file = resolveFile(request.url ?? "/");
  if (!file) {
    response.writeHead(404, { "content-type": types[".html"] });
    response.end(fallback);
    return;
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`e2e site http://127.0.0.1:${port}/\n`);
});
