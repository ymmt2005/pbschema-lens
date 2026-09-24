export type {
  DescriptorDomain,
  SymbolKind,
  SchemaModel,
  DocSymbol,
  PbSchemaLensPlugin,
  SemanticOptionRenderer,
  SchemaDiff,
} from "./types.js";
export { buildModel, type BuildModelOptions, type SourceLinkConfig } from "./model.js";
export { loadRegistryFromBytes, parseFileDescriptorSet, createUnifiedRegistry } from "./registry.js";
export { searchSymbols } from "./search.js";
export { diffModels } from "./diff.js";
export { builtinPlugins, isValidationRenderer, validationChips } from "./plugins.js";
export { fieldTableEntries, type FieldTableEntry } from "./field-table.js";
export {
  activePackageName,
  buildPackageNavTree,
  packageNodeOpen,
  type PackageNavItem,
  type PackageNavNode,
} from "./package-nav.js";
export { renderSafeMarkdown, escapeHtml } from "./markdown.js";
export { referenceIntegrity } from "./references.js";
export { classifyFile } from "./classify.js";
