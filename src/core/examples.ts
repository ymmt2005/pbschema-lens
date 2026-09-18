import type { DocField, DocMessage, SchemaModel, TypeRef } from "./types.js";

export function buildExampleJson(message: DocMessage, model: SchemaModel, depth = 0): unknown {
  if (depth > 4) {
    return {};
  }
  const object: Record<string, unknown> = {};
  for (const fieldId of message.fieldIds) {
    const field = model.fields.find((item) => item.id === fieldId);
    if (!field || field.deprecated) {
      continue;
    }
    object[field.jsonName] = exampleField(field, model, depth);
  }
  return object;
}

export function buildExampleTextProto(message: DocMessage, model: SchemaModel): string {
  const json = buildExampleJson(message, model) as Record<string, unknown>;
  return Object.entries(json)
    .map(([key, value]) => formatTextField(key, value, 0))
    .join("\n");
}

function exampleField(field: DocField, model: SchemaModel, depth: number): unknown {
  if (field.cardinality === "map") {
    return { key: exampleType(field.mapValue, model, depth + 1) };
  }
  if (field.cardinality === "repeated") {
    return [exampleType(field.type, model, depth + 1)];
  }
  return exampleType(field.type, model, depth + 1);
}

function exampleType(type: TypeRef | undefined, model: SchemaModel, depth: number): unknown {
  if (!type) {
    return null;
  }
  if (type.kind === "scalar") {
    return exampleScalar(type.name);
  }
  if (type.kind === "enum") {
    const doc = type.id ? model.enums.find((item) => item.id === type.id) : undefined;
    const first = doc ? model.enumValues.find((item) => item.id === doc.valueIds[0]) : undefined;
    return first?.shortName ?? type.name;
  }
  if (type.name === "google.protobuf.Timestamp") {
    return "2026-09-18T17:30:00Z";
  }
  if (type.name === "google.protobuf.Duration") {
    return "1.500s";
  }
  if (type.name === "google.protobuf.Empty") {
    return {};
  }
  if (type.name === "google.protobuf.FieldMask") {
    return "displayName,email";
  }
  if (type.name.endsWith("Value") && type.name.startsWith("google.protobuf.")) {
    return exampleWrapper(type.name);
  }
  const message = type.id ? model.messages.find((item) => item.id === type.id) : undefined;
  if (!message) {
    return {};
  }
  return buildExampleJson(message, model, depth + 1);
}

function exampleScalar(name: string): unknown {
  switch (name) {
    case "bool":
      return true;
    case "string":
      return "string";
    case "bytes":
      return "Ynl0ZXM=";
    case "double":
    case "float":
      return 1.5;
    default:
      return 1;
  }
}

function exampleWrapper(name: string): unknown {
  if (name.includes("Bool")) return true;
  if (name.includes("String")) return "string";
  if (name.includes("Bytes")) return "Ynl0ZXM=";
  if (name.includes("64")) return "1";
  return 1;
}

function formatTextField(key: string, value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => formatTextField(key, item, indent)).join("\n");
  }
  if (value && typeof value === "object") {
    const body = Object.entries(value as Record<string, unknown>)
      .map(([child, childValue]) => formatTextField(child, childValue, indent + 1))
      .join("\n");
    return `${pad}${key} {\n${body}\n${pad}}`;
  }
  if (typeof value === "string") {
    return `${pad}${key}: "${value}"`;
  }
  return `${pad}${key}: ${String(value)}`;
}
