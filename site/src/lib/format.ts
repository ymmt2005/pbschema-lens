import type { DocSymbol, ReferenceKind, SymbolKind, TypeRef } from "../../../src/core/types.ts";
import { withBase } from "./data.ts";

export function kindLabel(kind: SymbolKind): string {
  switch (kind) {
    case "enum-value":
      return "enum value";
    default:
      return kind;
  }
}

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

const nestedKinds = new Set<DocSymbol["kind"]>(["field", "oneof", "method", "enum-value"]);

/**
 * Link to a symbol only when the page that hosts it was generated.
 * Fields, methods, oneofs, and enum values resolve to the parent page plus a fragment.
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

export function relationLabel(kind: ReferenceKind): string {
  switch (kind) {
    case "field-type":
      return "Field type";
    case "map-value-type":
      return "Map value";
    case "map-key-type":
      return "Map key";
    case "rpc-input":
      return "RPC request";
    case "rpc-output":
      return "RPC response";
    case "extension-target":
      return "Extension target";
    case "option-definition":
      return "Option";
    case "nested-type":
      return "Nested type";
    case "file-import":
      return "Import";
    default:
      return "Reference";
  }
}

export function highlightProto(source: string): string {
  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.replace(
    /\b(syntax|edition|package|import|option|message|enum|service|rpc|returns|stream|repeated|optional|required|reserved|to|extend|oneof|map|true|false)\b|(\/\/.*$)|("(?:\\.|[^"])*")|(\b\d+\b)/gm,
    (match, keyword: string | undefined, comment: string | undefined, string: string | undefined, number: string | undefined) => {
      if (keyword) {
        return `<span class="text-[color:var(--accent)]">${match}</span>`;
      }
      if (comment) {
        return `<span class="text-[color:var(--fg-muted)]">${match}</span>`;
      }
      if (string) {
        return `<span class="text-[color:var(--accent-2)]">${match}</span>`;
      }
      if (number) {
        return `<span class="num">${match}</span>`;
      }
      return match;
    },
  );
}
