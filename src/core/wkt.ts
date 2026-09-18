export const WKT_FILES = new Set([
  "google/protobuf/any.proto",
  "google/protobuf/api.proto",
  "google/protobuf/descriptor.proto",
  "google/protobuf/duration.proto",
  "google/protobuf/empty.proto",
  "google/protobuf/field_mask.proto",
  "google/protobuf/source_context.proto",
  "google/protobuf/struct.proto",
  "google/protobuf/timestamp.proto",
  "google/protobuf/type.proto",
  "google/protobuf/wrappers.proto",
  "google/protobuf/compiler/plugin.proto",
  "google/protobuf/cpp_features.proto",
  "google/protobuf/java_features.proto",
  "google/protobuf/go_features.proto",
]);

export const WKT_PACKAGES = new Set(["google.protobuf", "google.protobuf.compiler"]);

export const WKT_NOTES: Record<string, string> = {
  "google.protobuf.Any": `A message that can contain any protobuf message, identified by a type URL.

**JSON:** \`{"@type": "type.googleapis.com/pkg.Message", ...fields}\`

Unpack at runtime using the type URL. Prefer a concrete field when the type is known.`,
  "google.protobuf.Timestamp": `A point in time, independent of time zone, encoded as UTC seconds and nanoseconds since the Unix epoch (1970-01-01T00:00:00Z).

**JSON:** an RFC 3339 string such as \`"2026-09-18T17:30:00Z"\`.

Range is approximately 0001-01-01 to 9999-12-31.`,
  "google.protobuf.Duration": `A signed span of time as seconds plus nanoseconds.

**JSON:** a string ending in \`s\`, for example \`"3.000000001s"\` or \`"-1.5s"\`.`,
  "google.protobuf.Empty": `A message with no fields. Common as an RPC request or response when no payload is needed.`,
  "google.protobuf.FieldMask": `A set of field paths used for partial updates.

**JSON:** a comma-separated string of lower-camel field paths, for example \`"user.displayName,photo"\`.`,
  "google.protobuf.Struct": `A JSON-object-like map of string keys to dynamically typed values.

**JSON:** a JSON object.`,
  "google.protobuf.Value": `A dynamically typed value (null, number, string, bool, struct, or list).

**JSON:** any JSON value.`,
  "google.protobuf.ListValue": `A wrapper for a repeated \`Value\`.

**JSON:** a JSON array.`,
  "google.protobuf.NullValue": `A singleton enum representing JSON \`null\`.`,
  "google.protobuf.DoubleValue": `Wrapper for \`double\`. **Obsolete for most new APIs** — prefer a proto3 optional field or Editions explicit presence. JSON is a JSON number.`,
  "google.protobuf.FloatValue": `Wrapper for \`float\`. **Obsolete for most new APIs.** JSON is a JSON number.`,
  "google.protobuf.Int64Value": `Wrapper for \`int64\`. **Obsolete for most new APIs.** JSON is a JSON string.`,
  "google.protobuf.UInt64Value": `Wrapper for \`uint64\`. **Obsolete for most new APIs.** JSON is a JSON string.`,
  "google.protobuf.Int32Value": `Wrapper for \`int32\`. **Obsolete for most new APIs.** JSON is a JSON number.`,
  "google.protobuf.UInt32Value": `Wrapper for \`uint32\`. **Obsolete for most new APIs.** JSON is a JSON number.`,
  "google.protobuf.BoolValue": `Wrapper for \`bool\`. **Obsolete for most new APIs.** JSON is \`true\` or \`false\`.`,
  "google.protobuf.StringValue": `Wrapper for \`string\`. **Obsolete for most new APIs.** JSON is a JSON string.`,
  "google.protobuf.BytesValue": `Wrapper for \`bytes\`. **Obsolete for most new APIs.** JSON is a base64 string.`,
};

export const HIDDEN_WKT_FILES = new Set([
  "google/protobuf/descriptor.proto",
  "google/protobuf/compiler/plugin.proto",
  "google/protobuf/api.proto",
  "google/protobuf/type.proto",
  "google/protobuf/source_context.proto",
  "google/protobuf/cpp_features.proto",
  "google/protobuf/java_features.proto",
  "google/protobuf/go_features.proto",
]);

export function isWktFile(fileName: string): boolean {
  return WKT_FILES.has(fileName);
}

export function isWktPackage(packageName: string): boolean {
  return WKT_PACKAGES.has(packageName);
}
