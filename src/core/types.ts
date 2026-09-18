export type DescriptorDomain =
  | "local"
  | "well-known"
  | "external-documented"
  | "external-undocumented";

export type SymbolKind =
  | "package"
  | "file"
  | "service"
  | "method"
  | "message"
  | "field"
  | "oneof"
  | "enum"
  | "enum-value"
  | "extension";

export type ReferenceKind =
  | "field-type"
  | "map-key-type"
  | "map-value-type"
  | "rpc-input"
  | "rpc-output"
  | "extension-target"
  | "option-definition"
  | "nested-type"
  | "file-import"
  | "other";

export type ScalarName =
  | "double"
  | "float"
  | "int32"
  | "int64"
  | "uint32"
  | "uint64"
  | "sint32"
  | "sint64"
  | "fixed32"
  | "fixed64"
  | "sfixed32"
  | "sfixed64"
  | "bool"
  | "string"
  | "bytes";

export type Cardinality = "implicit" | "optional" | "required" | "repeated" | "map";

export type OptionValue =
  | ScalarOptionValue
  | EnumOptionValue
  | MessageOptionValue
  | ListOptionValue
  | MapOptionValue
  | BytesOptionValue
  | UnknownOptionValue;

export interface ScalarOptionValue {
  kind: "scalar";
  scalar: ScalarName | "bool" | "string";
  value: string | number | boolean;
}

export interface EnumOptionValue {
  kind: "enum";
  enumType: string;
  name?: string;
  number: number;
}

export interface MessageOptionValue {
  kind: "message";
  typeName: string;
  fields: { name: string; number?: number; extension?: boolean; value: OptionValue }[];
  textProto: string;
}

export interface ListOptionValue {
  kind: "list";
  values: OptionValue[];
}

export interface MapOptionValue {
  kind: "map";
  entries: { key: string; value: OptionValue }[];
}

export interface BytesOptionValue {
  kind: "bytes";
  base64: string;
}

export interface UnknownOptionValue {
  kind: "unknown";
  fieldNumber: number;
  wireType: number;
  note: string;
}

export interface DocComment {
  leading?: string;
  trailing?: string;
  detached: string[];
  markdownHtml: string;
}

export interface SourceLocation {
  fileName: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SourceLink {
  label: string;
  url: string;
}

export interface SymbolReference {
  kind: ReferenceKind;
  fromId: string;
  toId: string;
  label?: string;
}

export interface SemanticPresentation {
  rendererId: string;
  title: string;
  summary: string;
  details?: string;
  badges?: string[];
}

export interface DocOption {
  name: string;
  fullName: string;
  number?: number;
  extension: boolean;
  builtIn: boolean;
  target: string;
  definitionId?: string;
  value: OptionValue;
  textProto: string;
  semantic?: SemanticPresentation;
}

export interface EffectiveFeature {
  name: string;
  declared?: string;
  effective: string;
  source: "declared" | "inherited" | "edition-default" | "runtime";
  inheritedFrom?: string;
}

export interface DocSymbol {
  id: string;
  kind: SymbolKind;
  fullName: string;
  shortName: string;
  packageName: string;
  fileName: string;
  domain: DescriptorDomain;
  generatePage: boolean;
  inNav: boolean;
  deprecated: boolean;
  comments?: DocComment;
  source?: SourceLocation;
  sourceLink?: SourceLink;
  repositoryLink?: SourceLink;
  options: DocOption[];
  references: SymbolReference[];
  referencedBy: SymbolReference[];
  urlPath: string;
  anchor?: string;
  features: EffectiveFeature[];
}

export interface DocPackage extends DocSymbol {
  kind: "package";
  serviceIds: string[];
  messageIds: string[];
  enumIds: string[];
  extensionIds: string[];
  fileIds: string[];
}

export interface DocFile extends DocSymbol {
  kind: "file";
  syntax: "proto2" | "proto3" | "editions";
  edition?: string;
  dependencyIds: string[];
  publicDependencyIds: string[];
  goPackage?: string;
  javaPackage?: string;
  csharpNamespace?: string;
  sourceText?: string;
}

export interface ReservedRange {
  start: number;
  end: number;
}

export interface DocMessage extends DocSymbol {
  kind: "message";
  parentId?: string;
  fieldIds: string[];
  oneofIds: string[];
  nestedMessageIds: string[];
  nestedEnumIds: string[];
  nestedExtensionIds: string[];
  extensionRanges: ReservedRange[];
  reservedRanges: ReservedRange[];
  reservedNames: string[];
  mapEntry: boolean;
  exampleJson?: unknown;
  exampleTextProto?: string;
}

export interface TypeRef {
  kind: "scalar" | "message" | "enum";
  name: string;
  id?: string;
  urlPath?: string;
  externalUrl?: string;
}

export interface DocField extends DocSymbol {
  kind: "field";
  parentId: string;
  number: number;
  jsonName: string;
  cardinality: Cardinality;
  type: TypeRef;
  mapKey?: TypeRef;
  mapValue?: TypeRef;
  oneofId?: string;
  packed?: boolean;
  defaultValue?: string;
  presence: string;
}

export interface DocOneof extends DocSymbol {
  kind: "oneof";
  parentId: string;
  fieldIds: string[];
}

export interface DocEnum extends DocSymbol {
  kind: "enum";
  parentId?: string;
  open: boolean;
  allowAlias: boolean;
  valueIds: string[];
  reservedRanges: ReservedRange[];
  reservedNames: string[];
}

export interface DocEnumValue extends DocSymbol {
  kind: "enum-value";
  parentId: string;
  number: number;
}

export interface DocService extends DocSymbol {
  kind: "service";
  methodIds: string[];
}

export interface DocMethod extends DocSymbol {
  kind: "method";
  parentId: string;
  input: TypeRef;
  output: TypeRef;
  clientStreaming: boolean;
  serverStreaming: boolean;
  streamingKind: "unary" | "client_streaming" | "server_streaming" | "bidi_streaming";
  idempotency?: string;
  signature: string;
}

export interface DocExtension extends DocSymbol {
  kind: "extension";
  number: number;
  extendee: TypeRef;
  type: TypeRef;
  optionTarget?:
    | "file"
    | "message"
    | "field"
    | "oneof"
    | "enum"
    | "enum-value"
    | "service"
    | "method";
  declaration: string;
}

export interface BuildInfo {
  title: string;
  generatedAt: string;
  generator: string;
  input: string;
  commit?: string;
  repository?: string;
  symbolCount: number;
  fileCount: number;
  timings: Record<string, number>;
  warnings: string[];
}

export interface SymbolIndexEntry {
  id: string;
  name: string;
  fullName: string;
  kind: SymbolKind;
  package: string;
  urlPath: string;
}

export interface SchemaModel {
  title: string;
  packages: DocPackage[];
  files: DocFile[];
  messages: DocMessage[];
  fields: DocField[];
  oneofs: DocOneof[];
  enums: DocEnum[];
  enumValues: DocEnumValue[];
  services: DocService[];
  methods: DocMethod[];
  extensions: DocExtension[];
  symbols: Record<string, DocSymbol>;
  byFullName: Record<string, string>;
  symbolIndex: SymbolIndexEntry[];
  buildInfo: BuildInfo;
  wktNotes: Record<string, string>;
  diff?: SchemaDiff;
}

export interface SymbolChange {
  id: string;
  fullName: string;
  kind: SymbolKind;
  change: "added" | "removed" | "modified";
  details: string[];
}

export interface BreakingViolation {
  rule: string;
  message: string;
  path?: string;
  symbolId?: string;
  categories: string[];
}

export interface SchemaDiff {
  againstLabel: string;
  added: SymbolChange[];
  removed: SymbolChange[];
  modified: SymbolChange[];
  breaking: BreakingViolation[];
}

export interface PageContribution {
  placement: "header" | "before-body" | "after-body" | "sidebar";
  title?: string;
  html: string;
}

export interface SemanticOptionRenderer {
  id: string;
  matches(option: DocOption, symbol: DocSymbol): boolean;
  render(option: DocOption, symbol: DocSymbol): SemanticPresentation;
}

export interface ExternalLinkResolver {
  id: string;
  resolve(fullName: string, kind: SymbolKind): string | undefined;
}

export interface ModelTransform {
  name: string;
  transform(model: SchemaModel): SchemaModel;
}

export interface PageContributor {
  name: string;
  contribute(symbol: DocSymbol, model: SchemaModel): PageContribution[];
}

export interface ProtolensPlugin {
  name: string;
  semanticOptionRenderers?: SemanticOptionRenderer[];
  externalLinkResolvers?: ExternalLinkResolver[];
  modelTransforms?: ModelTransform[];
  pageContributors?: PageContributor[];
}
