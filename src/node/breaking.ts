import type { BreakingViolation, SchemaModel } from "../core/types.js";
import { runBuf } from "./compile.js";

export async function collectBreaking(
  workDir: string,
  against: string,
  model: SchemaModel,
): Promise<BreakingViolation[]> {
  try {
    const { stdout, stderr } = await runBuf(workDir, [
      "breaking",
      "--against",
      against,
      "--error-format",
      "json",
    ]);
    const text = stdout || stderr;
    return parseBreaking(text, model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const jsonStart = message.indexOf("{");
    if (jsonStart >= 0) {
      return parseBreaking(message.slice(jsonStart), model);
    }
    const lines = message.split("\n").filter((line) => line.includes("{"));
    if (lines.length) {
      return parseBreaking(lines.join("\n"), model);
    }
    return [
      {
        rule: "buf.breaking",
        message: message.slice(0, 500),
        categories: ["FILE"],
      },
    ];
  }
}

function parseBreaking(text: string, model: SchemaModel): BreakingViolation[] {
  const violations: BreakingViolation[] = [];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: string;
        path?: string;
        start_line?: number;
      };
      const symbolId = matchSymbol(model, parsed.path, parsed.message);
      violations.push({
        rule: parsed.type ?? "BREAKING",
        message: parsed.message ?? line,
        path: parsed.path,
        symbolId,
        categories: categoriesFromRule(parsed.type ?? ""),
      });
    } catch {
      continue;
    }
  }
  return violations;
}

function matchSymbol(model: SchemaModel, path?: string, message?: string): string | undefined {
  if (path) {
    const file = model.files.find((item) => item.fullName === path || item.fullName.endsWith(path));
    if (file) {
      return file.id;
    }
  }
  if (!message) {
    return undefined;
  }
  for (const symbol of Object.values(model.symbols)) {
    if (symbol.fullName && message.includes(symbol.fullName)) {
      return symbol.id;
    }
  }
  return undefined;
}

function categoriesFromRule(rule: string): string[] {
  const upper = rule.toUpperCase();
  const found = ["WIRE", "WIRE_JSON", "PACKAGE", "FILE"].filter((item) => upper.includes(item));
  return found.length ? found : ["FILE"];
}
