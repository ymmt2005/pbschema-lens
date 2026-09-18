import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { compileInput, resolveBufBin, runBuf } from "./compile.js";
import { loadConfig, type ProtolensConfig } from "./config.js";
import { loadRegistryFromBytes } from "../core/registry.js";
import { buildModel } from "../core/model.js";

export interface DoctorFinding {
  level: "ok" | "warn" | "error";
  code: string;
  message: string;
}

export async function doctor(cwd: string, input: string, config: ProtolensConfig): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const buf = resolveBufBin();
  if (buf) {
    try {
      const { stdout } = await runBuf(cwd, ["--version"]);
      findings.push({ level: "ok", code: "buf", message: `Buf ${stdout.trim()} (${buf})` });
    } catch (error) {
      findings.push({
        level: "error",
        code: "buf",
        message: `Buf is installed but failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    findings.push({ level: "error", code: "buf", message: "Buf CLI was not found." });
  }

  try {
    const compiled = await compileInput(resolve(cwd, input));
    findings.push({
      level: "ok",
      code: "compile",
      message: `Compiled input (${compiled.kind}, ${compiled.bytes.byteLength} bytes)`,
    });
    const registry = loadRegistryFromBytes(compiled.bytes);
    const model = buildModel(registry, {
      title: config.title,
      inputLabel: input,
      classification: {
        include: config.documentation?.include,
        exclude: config.documentation?.exclude,
        localFiles: new Set(compiled.localFiles),
        externalLinks: config.externalLinks,
      },
    });
    findings.push({
      level: "ok",
      code: "model",
      message: `Loaded ${model.buildInfo.symbolCount} symbols from ${model.buildInfo.fileCount} files`,
    });
    const unresolved = Object.values(model.symbols).flatMap((symbol) =>
      symbol.options.filter((option) => option.value.kind === "unknown"),
    );
    if (unresolved.length) {
      findings.push({
        level: "warn",
        code: "options",
        message: `${unresolved.length} uninterpreted custom option value(s). Include the defining .proto files in the descriptor set.`,
      });
    } else {
      findings.push({ level: "ok", code: "options", message: "Custom options resolved." });
    }
    if (config.source?.repository || config.source?.urlTemplate) {
      findings.push({ level: "ok", code: "source-links", message: "Source link configuration is present." });
    } else {
      findings.push({
        level: "warn",
        code: "source-links",
        message: "No source.repository configured; View source links will be omitted unless git remote is detected.",
      });
    }
    const editions = model.files.filter((file) => file.syntax === "editions");
    findings.push({
      level: "ok",
      code: "editions",
      message: editions.length
        ? `${editions.length} file(s) use Protobuf Editions.`
        : "No Editions files in this schema.",
    });
  } catch (error) {
    findings.push({
      level: "error",
      code: "compile",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!existsSync(resolve(cwd, input))) {
    findings.push({ level: "error", code: "input", message: `Input path does not exist: ${input}` });
  }
  return findings;
}
