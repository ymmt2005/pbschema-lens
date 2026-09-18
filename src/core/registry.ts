import {
  create,
  createFileRegistry,
  fromBinary,
  type FileRegistry,
} from "@bufbuild/protobuf";
import {
  AnySchema,
  ApiSchema,
  DurationSchema,
  EmptySchema,
  FieldMaskSchema,
  FileDescriptorSetSchema,
  SourceContextSchema,
  StructSchema,
  TimestampSchema,
  TypeSchema,
  BoolValueSchema,
  BytesValueSchema,
  DoubleValueSchema,
  FloatValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  UInt32ValueSchema,
  UInt64ValueSchema,
  type FileDescriptorProto,
  type FileDescriptorSet,
} from "@bufbuild/protobuf/wkt";
import { isWktFile } from "./wkt.js";

const WKT_SCHEMAS = [
  AnySchema,
  ApiSchema,
  DurationSchema,
  EmptySchema,
  FieldMaskSchema,
  FileDescriptorSetSchema,
  SourceContextSchema,
  StructSchema,
  TimestampSchema,
  TypeSchema,
  BoolValueSchema,
  BytesValueSchema,
  DoubleValueSchema,
  FloatValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  UInt32ValueSchema,
  UInt64ValueSchema,
];

export function parseFileDescriptorSet(bytes: Uint8Array): FileDescriptorSet {
  return fromBinary(FileDescriptorSetSchema, bytes);
}

export function wktFileProtos(): Map<string, FileDescriptorProto> {
  const byName = new Map<string, FileDescriptorProto>();
  for (const schema of WKT_SCHEMAS) {
    const file = schema.file.proto;
    const name = file.name || `${schema.file.name}.proto`;
    if (!byName.has(name)) {
      byName.set(name, file);
    }
  }
  return byName;
}

export function createUnifiedRegistry(userSet: FileDescriptorSet): FileRegistry {
  const bundled = wktFileProtos();
  const byName = new Map<string, FileDescriptorProto>();
  for (const file of userSet.file) {
    if (file.name) {
      byName.set(file.name, file);
    }
  }
  const queue = [...byName.keys()];
  while (queue.length) {
    const name = queue.pop();
    if (!name) {
      continue;
    }
    const file = byName.get(name);
    if (!file) {
      continue;
    }
    for (const dep of file.dependency) {
      if (byName.has(dep)) {
        continue;
      }
      const bundledFile = bundled.get(dep);
      if (bundledFile) {
        byName.set(dep, bundledFile);
        queue.push(dep);
      }
    }
  }
  const merged = create(FileDescriptorSetSchema, {
    file: [...byName.values()],
  });
  return createFileRegistry(merged);
}

export function loadRegistryFromBytes(bytes: Uint8Array): FileRegistry {
  return createUnifiedRegistry(parseFileDescriptorSet(bytes));
}

export function missingWktFiles(registry: FileRegistry): string[] {
  const present = new Set<string>();
  for (const file of registry.files) {
    present.add(file.proto.name || `${file.name}.proto`);
  }
  return [...wktFileProtos().keys()].filter((name) => isWktFile(name) && !present.has(name));
}
