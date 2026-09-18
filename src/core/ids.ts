import type { SymbolKind } from "./types.js";

export function symbolId(kind: SymbolKind, fullName: string): string {
  return `${kind}:${fullName}`;
}

export function fieldId(messageFullName: string, fieldName: string): string {
  return symbolId("field", `${messageFullName}.${fieldName}`);
}

export function methodId(serviceFullName: string, methodName: string): string {
  return symbolId("method", `${serviceFullName}.${methodName}`);
}

export function enumValueId(enumFullName: string, valueName: string): string {
  return symbolId("enum-value", `${enumFullName}.${valueName}`);
}

export function oneofId(messageFullName: string, oneofName: string): string {
  return symbolId("oneof", `${messageFullName}.${oneofName}`);
}

export function fileId(fileName: string): string {
  return symbolId("file", fileName);
}

export function packageId(packageName: string): string {
  return symbolId("package", packageName || "(unnamed)");
}

export function slug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
}

export function stripLeadingDot(name: string): string {
  return name.startsWith(".") ? name.slice(1) : name;
}
