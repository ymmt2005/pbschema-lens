import {
  type DescEnum,
  type DescExtension,
  type DescField,
  type DescFile,
  type DescMessage,
  type FileRegistry,
  type Message,
  ScalarType,
  getExtension,
  hasExtension,
  isFieldSet,
} from "@bufbuild/protobuf";
import { toText } from "@bufbuild/protobuf/txtpb";
import {
  EnumOptionsSchema,
  EnumValueOptionsSchema,
  FieldOptionsSchema,
  FileOptionsSchema,
  MessageOptionsSchema,
  MethodOptionsSchema,
  OneofOptionsSchema,
  ServiceOptionsSchema,
} from "@bufbuild/protobuf/wkt";
import type {
  BytesOptionValue,
  DocOption,
  EnumOptionValue,
  ListOptionValue,
  MapOptionValue,
  MessageOptionValue,
  OptionValue,
  ScalarName,
  ScalarOptionValue,
  SemanticOptionRenderer,
  UnknownOptionValue,
} from "./types.js";
import { symbolId } from "./ids.js";

const OPTION_EXTENDEES: Record<string, string> = {
  "google.protobuf.FileOptions": "file",
  "google.protobuf.MessageOptions": "message",
  "google.protobuf.FieldOptions": "field",
  "google.protobuf.OneofOptions": "oneof",
  "google.protobuf.EnumOptions": "enum",
  "google.protobuf.EnumValueOptions": "enum-value",
  "google.protobuf.ServiceOptions": "service",
  "google.protobuf.MethodOptions": "method",
};

const OPTIONS_SCHEMAS: Record<string, DescMessage> = {
  file: FileOptionsSchema,
  message: MessageOptionsSchema,
  field: FieldOptionsSchema,
  oneof: OneofOptionsSchema,
  enum: EnumOptionsSchema,
  "enum-value": EnumValueOptionsSchema,
  service: ServiceOptionsSchema,
  method: MethodOptionsSchema,
};

const SKIP_BUILTIN = new Set(["uninterpretedOption", "uninterpreted_option", "features"]);

export function collectOptionExtensions(registry: FileRegistry): DescExtension[] {
  const out: DescExtension[] = [];
  for (const file of registry.files) {
    collectFileExtensions(file, out);
  }
  return out.filter((ext) => OPTION_EXTENDEES[ext.extendee.typeName]);
}

function collectFileExtensions(file: DescFile, out: DescExtension[]): void {
  out.push(...file.extensions);
  const walk = (message: DescMessage) => {
    out.push(...message.nestedExtensions);
    for (const nested of message.nestedMessages) {
      walk(nested);
    }
  };
  for (const message of file.messages) {
    walk(message);
  }
}

export function extractOptions(
  optionsMessage: Message | undefined,
  target: "file" | "message" | "field" | "oneof" | "enum" | "enum-value" | "service" | "method",
  optionExtensions: DescExtension[],
  registry: FileRegistry,
  renderers: SemanticOptionRenderer[],
  symbol: { id: string },
): DocOption[] {
  const schema = OPTIONS_SCHEMAS[target];
  const docs: DocOption[] = [];
  if (!optionsMessage || !schema) {
    return docs;
  }

  for (const field of schema.fields) {
    if (SKIP_BUILTIN.has(field.name) || SKIP_BUILTIN.has(field.localName)) {
      continue;
    }
    if (!isFieldSet(optionsMessage, field)) {
      continue;
    }
    const value = builtinFieldValue(optionsMessage, field, registry);
    if (!value) {
      continue;
    }
    docs.push({
      name: field.name,
      fullName: field.name,
      number: field.number,
      extension: false,
      builtIn: true,
      target,
      value,
      textProto: formatOptionAssignment(field.name, value, false),
    });
  }

  for (const ext of optionExtensions) {
    if (ext.extendee.typeName !== schema.typeName) {
      continue;
    }
    if (!hasExtension(optionsMessage, ext)) {
      continue;
    }
    const raw = getExtension(optionsMessage, ext);
    const value = extensionToOptionValue(ext, raw, registry);
    const option: DocOption = {
      name: ext.name,
      fullName: ext.typeName,
      number: ext.number,
      extension: true,
      builtIn: false,
      target,
      definitionId: symbolId("extension", ext.typeName),
      value,
      textProto: formatOptionAssignment(ext.typeName, value, true),
    };
    docs.push(option);
  }

  for (const unknown of optionsMessage.$unknown ?? []) {
    const already = docs.some((doc) => doc.number === unknown.no);
    if (already) {
      continue;
    }
    const value: UnknownOptionValue = {
      kind: "unknown",
      fieldNumber: unknown.no,
      wireType: unknown.wireType,
      note: "Uninterpreted option value. The defining extension was not present in the descriptor set.",
    };
    docs.push({
      name: `#${unknown.no}`,
      fullName: `uninterpreted.${unknown.no}`,
      number: unknown.no,
      extension: true,
      builtIn: false,
      target,
      value,
      textProto: `(unknown field ${unknown.no})`,
    });
  }

  for (const option of docs) {
    for (const renderer of renderers) {
      if (renderer.matches(option, symbol as never)) {
        option.semantic = renderer.render(option, symbol as never);
        break;
      }
    }
  }

  return docs;
}

function builtinFieldValue(
  message: Message,
  field: DescField,
  registry: FileRegistry,
): OptionValue | undefined {
  const record = message as unknown as Record<string, unknown>;
  const raw = record[field.localName];
  return toOptionValue(field, raw, registry);
}

function extensionToOptionValue(
  ext: DescExtension,
  raw: unknown,
  registry: FileRegistry,
): OptionValue {
  return toOptionValue(ext as unknown as DescField, raw, registry);
}

function toOptionValue(
  field: DescField | DescExtension,
  raw: unknown,
  registry: FileRegistry,
): OptionValue {
  if (raw instanceof Uint8Array) {
    const bytes: BytesOptionValue = { kind: "bytes", base64: bytesToBase64(raw) };
    return bytes;
  }
  if (field.fieldKind === "list") {
    const values = Array.isArray(raw) ? raw.map((item) => fieldToValue(field, item, registry)) : [];
    const list: ListOptionValue = { kind: "list", values };
    return list;
  }
  if (field.fieldKind === "map") {
    const entries = Object.entries((raw as Record<string, unknown>) ?? {}).map(([key, value]) => ({
      key,
      value: fieldToValue(field, value, registry),
    }));
    const map: MapOptionValue = { kind: "map", entries };
    return map;
  }
  return fieldToValue(field, raw, registry);
}

function fieldToValue(
  field: DescField | DescExtension,
  raw: unknown,
  registry: FileRegistry,
): OptionValue {
  const kind = "listKind" in field && field.fieldKind === "list" ? field.listKind : field.fieldKind;
  const mapKind = "mapKind" in field && field.fieldKind === "map" ? field.mapKind : undefined;
  const effective = mapKind ?? kind;

  if (raw instanceof Uint8Array) {
    return { kind: "bytes", base64: bytesToBase64(raw) };
  }
  if (effective === "enum" || field.fieldKind === "enum" || (field.fieldKind === "list" && "listKind" in field && field.listKind === "enum")) {
    const enumDesc = field.enum;
    const number = Number(raw);
    const name = enumDesc?.value[number]?.name;
    const value: EnumOptionValue = {
      kind: "enum",
      enumType: enumDesc?.typeName ?? "enum",
      name,
      number,
    };
    return value;
  }
  if (
    effective === "message" ||
    field.fieldKind === "message" ||
    (field.fieldKind === "list" && "listKind" in field && field.listKind === "message")
  ) {
    const messageDesc = field.message;
    if (!messageDesc || !raw || typeof raw !== "object") {
      return { kind: "unknown", fieldNumber: field.number, wireType: 2, note: "empty message" };
    }
    return messageToOptionValue(messageDesc, raw as Message, registry);
  }
  if (typeof raw === "boolean") {
    const value: ScalarOptionValue = { kind: "scalar", scalar: "bool", value: raw };
    return value;
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "bigint") {
    const scalar = scalarName(field);
    const value: ScalarOptionValue = {
      kind: "scalar",
      scalar,
      value: typeof raw === "bigint" ? raw.toString() : raw,
    };
    return value;
  }
  return {
    kind: "unknown",
    fieldNumber: field.number,
    wireType: 0,
    note: `Unsupported option value (${typeof raw})`,
  };
}

function messageToOptionValue(
  desc: DescMessage,
  message: Message,
  registry: FileRegistry,
): MessageOptionValue {
  const fields: MessageOptionValue["fields"] = [];
  for (const field of desc.fields) {
    if (!isFieldSet(message, field)) {
      continue;
    }
    const record = message as unknown as Record<string, unknown>;
    fields.push({
      name: field.name,
      number: field.number,
      value: toOptionValue(field, record[field.localName], registry),
    });
  }
  for (const unknown of message.$unknown ?? []) {
    const ext = registry.getExtensionFor(desc, unknown.no);
    if (ext && hasExtension(message, ext)) {
      fields.push({
        name: ext.typeName,
        number: ext.number,
        extension: true,
        value: extensionToOptionValue(ext, getExtension(message, ext), registry),
      });
    }
  }
  let textProto = "";
  try {
    textProto = toText(desc, message, { registry, printUnknownFields: true }).trim();
  } catch {
    textProto = fields.map((field) => `${field.name}: ...`).join("\n");
  }
  return {
    kind: "message",
    typeName: desc.typeName,
    fields,
    textProto,
  };
}

function scalarName(field: DescField | DescExtension): ScalarName {
  const scalar = "scalar" in field ? field.scalar : undefined;
  switch (scalar) {
    case ScalarType.DOUBLE:
      return "double";
    case ScalarType.FLOAT:
      return "float";
    case ScalarType.INT64:
      return "int64";
    case ScalarType.UINT64:
      return "uint64";
    case ScalarType.INT32:
      return "int32";
    case ScalarType.FIXED64:
      return "fixed64";
    case ScalarType.FIXED32:
      return "fixed32";
    case ScalarType.BOOL:
      return "bool";
    case ScalarType.STRING:
      return "string";
    case ScalarType.BYTES:
      return "bytes";
    case ScalarType.UINT32:
      return "uint32";
    case ScalarType.SFIXED32:
      return "sfixed32";
    case ScalarType.SFIXED64:
      return "sfixed64";
    case ScalarType.SINT32:
      return "sint32";
    case ScalarType.SINT64:
      return "sint64";
    default:
      return "string";
  }
}

export function formatOptionAssignment(name: string, value: OptionValue, extension: boolean): string {
  const lhs = extension ? `(${name})` : name;
  return `${lhs} = ${formatValue(value, 0)}`;
}

export function formatValue(value: OptionValue, indent: number): string {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  switch (value.kind) {
    case "scalar":
      return typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
    case "enum":
      return value.name ?? String(value.number);
    case "bytes":
      return `"<bytes ${value.base64.slice(0, 16)}…>"`;
    case "list":
      if (value.values.length === 0) {
        return "[]";
      }
      return `[\n${value.values.map((item) => `${inner}${formatValue(item, indent + 1)}`).join(",\n")}\n${pad}]`;
    case "map":
      return `{\n${value.entries.map((entry) => `${inner}${entry.key}: ${formatValue(entry.value, indent + 1)}`).join("\n")}\n${pad}}`;
    case "message":
      if (!value.textProto) {
        return "{}";
      }
      if (!value.textProto.includes("\n")) {
        return `{ ${value.textProto} }`;
      }
      return `{\n${value.textProto
        .split("\n")
        .filter(Boolean)
        .map((line) => `${inner}${line}`)
        .join("\n")}\n${pad}}`;
    case "unknown":
      return `/* ${value.note} */`;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export { OPTION_EXTENDEES };
