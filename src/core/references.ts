import type { ReferenceKind, SchemaModel, SymbolReference } from "./types.js";

export function addReference(
  refs: SymbolReference[],
  kind: ReferenceKind,
  fromId: string,
  toId: string,
  label?: string,
): void {
  if (!fromId || !toId) {
    return;
  }
  refs.push({ kind, fromId, toId, label });
}

export function invertReferences(forward: SymbolReference[]): Map<string, SymbolReference[]> {
  const incoming = new Map<string, SymbolReference[]>();
  for (const ref of forward) {
    const list = incoming.get(ref.toId) ?? [];
    list.push(ref);
    incoming.set(ref.toId, list);
  }
  return incoming;
}

export function attachReferences(model: SchemaModel, forward: SymbolReference[]): void {
  const incoming = invertReferences(forward);
  const byId = model.symbols;
  for (const ref of forward) {
    const from = byId[ref.fromId];
    if (from) {
      from.references.push(ref);
    }
  }
  for (const [toId, refs] of incoming) {
    const to = byId[toId];
    if (to) {
      to.referencedBy.push(...refs);
    }
  }
}

export function referenceIntegrity(model: SchemaModel): string[] {
  const errors: string[] = [];
  const ids = new Set(Object.keys(model.symbols));
  for (const symbol of Object.values(model.symbols)) {
    for (const ref of symbol.references) {
      if (ref.fromId !== symbol.id) {
        errors.push(`Forward reference on ${symbol.id} has mismatched fromId ${ref.fromId}`);
      }
      if (!ids.has(ref.toId) && !ref.toId.startsWith("external:")) {
        errors.push(`Dangling forward reference ${ref.fromId} -> ${ref.toId}`);
      }
    }
    for (const ref of symbol.referencedBy) {
      if (ref.toId !== symbol.id) {
        errors.push(`Reverse reference on ${symbol.id} has mismatched toId ${ref.toId}`);
      }
    }
  }
  return errors;
}
