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
