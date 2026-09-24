#!/usr/bin/env node
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { Command } from "commander";
import { watch } from "chokidar";
import { createServer } from "node:http";
import { resolveRuntime } from "./node/runtime.js";
import { buildDocumentation } from "./node/pipeline.js";
import { doctor } from "./node/doctor.js";
import { initProject } from "./node/init.js";

const program = new Command();
program.name("pbschema-lens").description("Static schema explorer for Protocol Buffers").version("0.3.0");

program
  .command("build")
  .argument("[input]", "Buf workspace, proto directory, or FileDescriptorSet")
  .option("-o, --out <dir>", "Output directory")
  .option("-c, --config <file>", "Config file")
  .option("--base <path>", "Site base path, e.g. /repo-name/")
  .option("--against <file>", "Previous descriptor set or directory for schema diff")
  .option("--title <title>", "Site title")
  .action(async (inputArg: string | undefined, flags) => {
    const { cwd, config, input, outDir } = resolveRuntime(process.cwd(), inputArg, flags);
    const started = Date.now();
    process.stdout.write(banner());
    const model = await buildDocumentation({
      input,
      outDir,
      config,
      against: flags.against,
      cwd,
    });
    printSummary(model, outDir, Date.now() - started);
  });

program
  .command("dev")
  .argument("[input]", "Buf workspace, proto directory, or FileDescriptorSet")
  .option("-o, --out <dir>", "Output directory")
  .option("-c, --config <file>", "Config file")
  .option("--base <path>", "Site base path, e.g. /repo-name/")
  .option("--title <title>", "Site title")
  .option("--port <port>", "Preview port", "43147")
  .action(async (inputArg: string | undefined, flags) => {
    const { cwd, config, input, outDir } = resolveRuntime(process.cwd(), inputArg, flags);
    const rebuild = async () => {
      try {
        await buildDocumentation({ input, outDir, config, cwd });
        console.log(`Rebuilt ${outDir}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    };
    await rebuild();
    const port = Number(flags.port);
    await serve(outDir, port);
    console.log(`Preview: http://127.0.0.1:${port}/`);
    watch(input, {
      ignoreInitial: true,
      ignored: (path, stats) => Boolean(stats?.isFile() && !isDevWatchFile(path)),
    }).on("all", () => {
      void rebuild();
    });
  });

program
  .command("doctor")
  .argument("[input]", "Schema input")
  .option("-c, --config <file>", "Config file")
  .action(async (inputArg: string | undefined, flags) => {
    const { cwd, config, input } = resolveRuntime(process.cwd(), inputArg, flags);
    const findings = await doctor(cwd, input, config);
    for (const finding of findings) {
      const tag = finding.level.toUpperCase().padEnd(5);
      console.log(`${tag} ${finding.code.padEnd(14)} ${finding.message}`);
    }
    if (findings.some((finding) => finding.level === "error")) {
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .option("--github-pages", "Write a GitHub Pages workflow")
  .action(async (flags) => {
    const written = await initProject(process.cwd(), { githubPages: Boolean(flags.githubPages) });
    console.log(`Wrote ${written.join(", ")}`);
  });

program
  .command("diff")
  .argument("[input]", "Current schema")
  .requiredOption("--against <file>", "Previous schema")
  .option("-o, --out <dir>", "Output directory")
  .option("-c, --config <file>", "Config file")
  .option("--base <path>", "Site base path, e.g. /repo-name/")
  .option("--title <title>", "Site title")
  .action(async (inputArg: string | undefined, flags) => {
    const { cwd, config, input, outDir } = resolveRuntime(process.cwd(), inputArg, flags);
    const model = await buildDocumentation({
      input,
      outDir,
      config,
      against: flags.against,
      cwd,
    });
    const diff = model.diff;
    if (!diff) {
      console.log("No diff produced.");
      return;
    }
    console.log(`+ ${diff.added.length}  ~ ${diff.modified.length}  - ${diff.removed.length}  breaking ${diff.breaking.length}`);
  });

function isDevWatchFile(path: string): boolean {
  const name = basename(path);
  return (
    name.endsWith(".proto") ||
    name.endsWith(".binpb") ||
    name.endsWith(".pb") ||
    name.endsWith(".desc") ||
    name === "buf.yaml" ||
    name === "buf.lock" ||
    name === "pbschema-lens.yaml" ||
    name === "pbschema-lens.yml"
  );
}

function banner(): string {
  return "pbschema-lens — static protobuf schema explorer\n";
}

function printSummary(
  model: Awaited<ReturnType<typeof buildDocumentation>>,
  outDir: string,
  elapsed: number,
): void {
  const optionDefs = model.extensions.filter((item) => item.optionTarget).length;
  const pages =
    model.packages.filter((item) => item.generatePage).length +
    model.messages.filter((item) => item.generatePage).length +
    model.enums.filter((item) => item.generatePage).length +
    model.services.filter((item) => item.generatePage).length +
    model.methods.filter((item) => item.generatePage).length +
    model.extensions.filter((item) => item.generatePage).length;
  console.log(`Loaded ${model.buildInfo.symbolCount} symbols`);
  console.log(`Resolved ${optionDefs} custom option definitions`);
  console.log(`Generated ${pages} documentation pages`);
  console.log(`Indexed ${model.symbolIndex.length} symbols`);
  for (const [name, ms] of Object.entries(model.buildInfo.timings)) {
    console.log(`  ${name.padEnd(20)} ${ms} ms`);
  }
  console.log(`Output: ${outDir} (${elapsed} ms)`);
}

async function serve(root: string, port: number): Promise<void> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let relative = decodeURIComponent(url.pathname);
      if (relative.endsWith("/")) {
        relative += "index.html";
      }
      const path = normalize(join(root, relative));
      if (!path.startsWith(root)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      let file = path;
      try {
        const info = await stat(file);
        if (info.isDirectory()) {
          file = join(file, "index.html");
        }
      } catch {
        file = `${path}.html`;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });
  await mkdir(root, { recursive: true });
  await new Promise<void>((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
}

await program.parseAsync(process.argv);

