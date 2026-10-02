import type { ReferenceKind, SymbolKind } from "../../../src/core/types.ts";

export function kindLabel(kind: SymbolKind): string {
  switch (kind) {
    case "enum-value":
      return "enum value";
    default:
      return kind;
  }
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
