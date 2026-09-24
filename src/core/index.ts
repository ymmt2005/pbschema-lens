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
  HOME_PACKAGE_AREA_LIMIT,
  activePackageName,
  buildPackageNavTree,
  homePackageAreas,
  packageNodeOpen,
  type PackageAreaCounts,
  type PackageAreaPackage,
  type PackageAreaRow,
  type PackageNavItem,
  type PackageNavNode,
} from "./package-nav.js";
export { buildSourceTree, sourceNodeOpen, type SourceTreeFile, type SourceTreeNode } from "./source-tree.js";
export { renderSafeMarkdown, escapeHtml } from "./markdown.js";
export { referenceIntegrity } from "./references.js";
export { classifyFile } from "./classify.js";
