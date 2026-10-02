import type { DocSymbol, TypeRef } from "../../../src/core/types.ts";
import { withBase } from "./data.ts";

export { kindLabel, relationLabel } from "./labels.ts";

export function typeHref(type: TypeRef | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  if (type.externalUrl) {
    return type.externalUrl;
  }
  if (type.urlPath) {
    return withBase(type.urlPath);
  }
  return undefined;
}

export function symbolHref(symbol: Pick<DocSymbol, "urlPath" | "anchor">): string {
  const path = withBase(symbol.urlPath);
  return symbol.anchor ? `${path}#${symbol.anchor}` : path;
}

const nestedKinds = new Set<DocSymbol["kind"]>(["field", "oneof", "enum-value"]);

/**
 * Link to a symbol only when the page that hosts it was generated.
 * Fields, oneofs, and enum values resolve to the parent page plus a fragment.
 * Methods link to their own page.
 */
export function linkedPath(
  symbol: DocSymbol,
  symbols: Record<string, DocSymbol>,
): string | undefined {
  if (nestedKinds.has(symbol.kind)) {
    const parentId = "parentId" in symbol ? symbol.parentId : undefined;
    const parent = parentId ? symbols[parentId] : undefined;
    if (!parent?.generatePage || !symbol.anchor) return undefined;
    return `${symbol.urlPath}#${symbol.anchor}`;
  }
  if (!symbol.generatePage) return undefined;
  return symbol.urlPath;
}

export function linkedHref(symbol: DocSymbol, symbols: Record<string, DocSymbol>): string | undefined {
  const path = linkedPath(symbol, symbols);
  return path ? withBase(path) : undefined;
}

export { highlightProto } from "./highlight.ts";
