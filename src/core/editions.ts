import {
  Edition,
  FeatureSet_EnumType,
  FeatureSet_FieldPresence,
  FeatureSet_JsonFormat,
  FeatureSet_MessageEncoding,
  FeatureSet_RepeatedFieldEncoding,
  FeatureSet_Utf8Validation,
  type FeatureSet,
} from "@bufbuild/protobuf/wkt";
import type {
  DescEnum,
  DescExtension,
  DescField,
  DescFile,
  DescMessage,
} from "@bufbuild/protobuf";
import type { EffectiveFeature } from "./types.js";

export function editionLabel(edition: Edition | number): string {
  switch (edition) {
    case Edition.EDITION_PROTO2:
      return "proto2";
    case Edition.EDITION_PROTO3:
      return "proto3";
    case Edition.EDITION_2023:
      return "2023";
    case Edition.EDITION_2024:
      return "2024";
    default:
      return String(edition);
  }
}

export function fileSyntax(file: DescFile): "proto2" | "proto3" | "editions" {
  if (file.edition === Edition.EDITION_PROTO2) {
    return "proto2";
  }
  if (file.edition === Edition.EDITION_PROTO3) {
    return "proto3";
  }
  return "editions";
}

export function fieldFeatures(field: DescField): EffectiveFeature[] {
  const declared = declaredFeatures(field.proto.options?.features);
  const features: EffectiveFeature[] = [
    feature("field_presence", presenceName(field.presence), declared.fieldPresence, field.parent.typeName),
    feature(
      "utf8_validation",
      field.utf8Validation ? "VERIFY" : "NONE",
      declared.utf8Validation,
      field.parent.typeName,
    ),
  ];
  if (field.fieldKind === "list") {
    features.push(
      feature(
        "repeated_field_encoding",
        field.packed ? "PACKED" : "EXPANDED",
        declared.repeatedFieldEncoding,
        field.parent.typeName,
      ),
    );
  }
  if (field.fieldKind === "message" || (field.fieldKind === "list" && field.listKind === "message")) {
    const delimited = "delimitedEncoding" in field ? field.delimitedEncoding : false;
    features.push(
      feature(
        "message_encoding",
        delimited ? "DELIMITED" : "LENGTH_PREFIXED",
        declared.messageEncoding,
        field.parent.typeName,
      ),
    );
  }
  return features;
}

export function messageFeatures(message: DescMessage): EffectiveFeature[] {
  const declared = declaredFeatures(message.proto.options?.features);
  return [
    feature(
      "json_format",
      declared.jsonFormat ?? editionJsonDefault(message.file.edition),
      declared.jsonFormat,
      message.file.name,
    ),
  ];
}

export function enumFeatures(value: DescEnum): EffectiveFeature[] {
  const declared = declaredFeatures(value.proto.options?.features);
  return [
    feature("enum_type", value.open ? "OPEN" : "CLOSED", declared.enumType, value.file.name),
  ];
}

export function extensionFeatures(ext: DescExtension): EffectiveFeature[] {
  const declared = declaredFeatures(ext.proto.options?.features);
  return [
    feature("field_presence", presenceName(ext.presence), declared.fieldPresence, ext.file.name),
  ];
}

function feature(
  name: string,
  effective: string,
  declared: string | undefined,
  inheritedFrom: string,
): EffectiveFeature {
  if (declared) {
    return { name, declared, effective, source: "declared" };
  }
  return {
    name,
    effective,
    source: inheritedFrom ? "inherited" : "edition-default",
    inheritedFrom,
  };
}

function declaredFeatures(features: FeatureSet | undefined): Record<string, string | undefined> {
  if (!features) {
    return {};
  }
  const named = (label: string | undefined) =>
    label && !label.includes("UNKNOWN") ? label : undefined;
  return {
    fieldPresence: named(FeatureSet_FieldPresence[features.fieldPresence]),
    enumType: named(FeatureSet_EnumType[features.enumType]),
    repeatedFieldEncoding: named(FeatureSet_RepeatedFieldEncoding[features.repeatedFieldEncoding]),
    utf8Validation: named(FeatureSet_Utf8Validation[features.utf8Validation]),
    messageEncoding: named(FeatureSet_MessageEncoding[features.messageEncoding]),
    jsonFormat: named(FeatureSet_JsonFormat[features.jsonFormat]),
  };
}

function presenceName(presence: number): string {
  switch (presence) {
    case FeatureSet_FieldPresence.EXPLICIT:
      return "EXPLICIT";
    case FeatureSet_FieldPresence.IMPLICIT:
      return "IMPLICIT";
    case FeatureSet_FieldPresence.LEGACY_REQUIRED:
      return "LEGACY_REQUIRED";
    default:
      return String(presence);
  }
}

function editionJsonDefault(edition: number): string {
  if (edition === Edition.EDITION_PROTO2) {
    return "LEGACY_BEST_EFFORT";
  }
  return "ALLOW";
}
