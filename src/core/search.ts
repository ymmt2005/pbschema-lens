import type { SchemaModel, SymbolIndexEntry, SymbolKind } from "./types.js";

export interface RankedHit {
  entry: SymbolIndexEntry;
  score: number;
  reason: string;
}

export function searchSymbols(model: SchemaModel, query: string, kinds?: SymbolKind[]): RankedHit[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const lower = q.toLowerCase();
  const hits: RankedHit[] = [];
  for (const entry of model.symbolIndex) {
    if (kinds && kinds.length && !kinds.includes(entry.kind)) {
      continue;
    }
    const hit = rank(entry, q, lower);
    if (hit) {
      hits.push(hit);
    }
  }
  hits.sort((a, b) => b.score - a.score || a.entry.fullName.localeCompare(b.entry.fullName));
  return hits.slice(0, 50);
}

function rank(entry: SymbolIndexEntry, query: string, lower: string): RankedHit | undefined {
  if (entry.fullName === query) {
    return { entry, score: 100, reason: "exact fully qualified name" };
  }
  if (entry.name === query) {
    return { entry, score: 90, reason: "exact short name" };
  }
  const fullLower = entry.fullName.toLowerCase();
  const nameLower = entry.name.toLowerCase();
  if (fullLower === lower) {
    return { entry, score: 95, reason: "exact fully qualified name" };
  }
  if (nameLower === lower) {
    return { entry, score: 88, reason: "exact short name" };
  }
  if (fullLower.startsWith(lower) || nameLower.startsWith(lower)) {
    return { entry, score: 70, reason: "prefix match" };
  }
  if (fullLower.includes(lower) || nameLower.includes(lower)) {
    return { entry, score: 40, reason: "substring match" };
  }
  if (fuzzy(nameLower, lower) || fuzzy(fullLower, lower)) {
    return { entry, score: 20, reason: "symbol-name fuzzy match" };
  }
  return undefined;
}

function fuzzy(haystack: string, needle: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) {
      i += 1;
      if (i === needle.length) {
        return true;
      }
    }
  }
  return false;
}
