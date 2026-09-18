import type { SchemaDiff, SchemaModel, SymbolChange, SymbolKind } from "./types.js";

export function diffModels(current: SchemaModel, previous: SchemaModel, againstLabel: string): SchemaDiff {
  const currentIds = new Set(Object.keys(current.symbols));
  const previousIds = new Set(Object.keys(previous.symbols));
  const added: SymbolChange[] = [];
  const removed: SymbolChange[] = [];
  const modified: SymbolChange[] = [];

  for (const id of currentIds) {
    if (!previousIds.has(id)) {
      const symbol = current.symbols[id];
      added.push({
        id,
        fullName: symbol.fullName,
        kind: symbol.kind,
        change: "added",
        details: [`Added ${symbol.kind} ${symbol.fullName}`],
      });
    }
  }
  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      const symbol = previous.symbols[id];
      removed.push({
        id,
        fullName: symbol.fullName,
        kind: symbol.kind,
        change: "removed",
        details: [`Removed ${symbol.kind} ${symbol.fullName}`],
      });
    }
  }
  for (const id of currentIds) {
    if (!previousIds.has(id)) {
      continue;
    }
    const details = describeModification(current, previous, id);
    if (details.length) {
      const symbol = current.symbols[id];
      modified.push({
        id,
        fullName: symbol.fullName,
        kind: symbol.kind,
        change: "modified",
        details,
      });
    }
  }

  sortChanges(added);
  sortChanges(removed);
  sortChanges(modified);
  return { againstLabel, added, removed, modified, breaking: [] };
}

function describeModification(current: SchemaModel, previous: SchemaModel, id: string): string[] {
  const details: string[] = [];
  const now = current.symbols[id];
  const then = previous.symbols[id];
  if (now.deprecated !== then.deprecated) {
    details.push(now.deprecated ? "Marked deprecated" : "Deprecation removed");
  }
  if (now.kind === "field") {
    const a = current.fields.find((item) => item.id === id);
    const b = previous.fields.find((item) => item.id === id);
    if (a && b) {
      if (a.number !== b.number) details.push(`Field number ${b.number} → ${a.number}`);
      if (a.type.name !== b.type.name) details.push(`Type ${b.type.name} → ${a.type.name}`);
      if (a.cardinality !== b.cardinality) details.push(`Cardinality ${b.cardinality} → ${a.cardinality}`);
      if (a.jsonName !== b.jsonName) details.push(`JSON name ${b.jsonName} → ${a.jsonName}`);
    }
  }
  if (now.kind === "enum-value") {
    const a = current.enumValues.find((item) => item.id === id);
    const b = previous.enumValues.find((item) => item.id === id);
    if (a && b && a.number !== b.number) {
      details.push(`Number ${b.number} → ${a.number}`);
    }
  }
  if (now.kind === "message") {
    const a = current.messages.find((item) => item.id === id);
    const b = previous.messages.find((item) => item.id === id);
    if (a && b) {
      const addedFields = a.fieldIds.filter((fieldId) => !b.fieldIds.includes(fieldId));
      const removedFields = b.fieldIds.filter((fieldId) => !a.fieldIds.includes(fieldId));
      for (const fieldId of addedFields) {
        const field = current.fields.find((item) => item.id === fieldId);
        details.push(`+ ${field?.shortName ?? fieldId}${field ? ` = ${field.number}` : ""}`);
      }
      for (const fieldId of removedFields) {
        const field = previous.fields.find((item) => item.id === fieldId);
        details.push(`- ${field?.shortName ?? fieldId}${field ? ` = ${field.number}` : ""}`);
      }
    }
  }
  const optionChanges = diffOptions(now.options, then.options);
  details.push(...optionChanges);
  return details;
}

function diffOptions(
  current: SchemaModel["messages"][number]["options"],
  previous: SchemaModel["messages"][number]["options"],
): string[] {
  const details: string[] = [];
  const prevMap = new Map(previous.map((option) => [option.fullName, option]));
  const curMap = new Map(current.map((option) => [option.fullName, option]));
  for (const [name, option] of curMap) {
    const old = prevMap.get(name);
    if (!old) {
      details.push(`Option ${name} added`);
    } else if (old.textProto !== option.textProto) {
      details.push(`Option ${name} changed`);
    }
  }
  for (const name of prevMap.keys()) {
    if (!curMap.has(name)) {
      details.push(`Option ${name} removed`);
    }
  }
  return details;
}

function sortChanges(changes: SymbolChange[]): void {
  const order: SymbolKind[] = [
    "package",
    "file",
    "service",
    "method",
    "message",
    "field",
    "oneof",
    "enum",
    "enum-value",
    "extension",
  ];
  changes.sort((a, b) => {
    const kind = order.indexOf(a.kind) - order.indexOf(b.kind);
    return kind !== 0 ? kind : a.fullName.localeCompare(b.fullName);
  });
}
