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
export { renderSafeMarkdown, escapeHtml } from "./markdown.js";
export { referenceIntegrity } from "./references.js";
export { classifyFile } from "./classify.js";
