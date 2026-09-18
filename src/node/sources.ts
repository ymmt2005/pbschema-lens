import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadSourceTexts(root: string, fileNames: string[]): Promise<Record<string, string>> {
  const texts: Record<string, string> = {};
  for (const fileName of fileNames) {
    const candidates = [join(root, fileName), join(root, "proto", fileName)];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        texts[fileName] = await readFile(candidate, "utf8");
        break;
      } catch {
        continue;
      }
    }
  }
  return texts;
}

export function sanitizeOutputPath(fileName: string): string {
  const normalized = fileName.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.split("/").includes("..")) {
    throw new Error(`Refusing to write unsafe path: ${fileName}`);
  }
  return normalized;
}
