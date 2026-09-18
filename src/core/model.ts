import {
  type DescEnum,
  type DescExtension,
  type DescField,
  type DescFile,
  type DescMessage,
  type DescMethod,
  type DescService,
  type FileRegistry,
  ScalarType,
} from "@bufbuild/protobuf";
import { nestedTypes } from "@bufbuild/protobuf/reflect";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import type {
  Cardinality,
  DocComment,
  DocEnum,
  DocEnumValue,
  DocExtension,
  DocField,
  DocFile,
  DocMessage,
  DocMethod,
  DocOneof,
  DocPackage,
  DocService,
  DocSymbol,
  ProtolensPlugin,
  ScalarName,
  SchemaModel,
  SourceLink,
  SymbolIndexEntry,
  SymbolKind,
  SymbolReference,
  TypeRef,
} from "./types.js";
import { type ClassificationConfig, classifyFile, resolveExternalUrl } from "./classify.js";
import { commentsFor, indexLocations, locationToComment, locationToSource } from "./comments.js";
import { editionLabel, enumFeatures, extensionFeatures, fieldFeatures, fileSyntax, messageFeatures } from "./editions.js";
import { buildExampleJson, buildExampleTextProto } from "./examples.js";
import { enumValueId, fieldId, fileId, methodId, oneofId, packageId, symbolId } from "./ids.js";
import { href, urlPathFor, fileSourcePath, repositoryBlobUrl, type SourceLinkConfig } from "./urls.js";
import { collectOptionExtensions, extractOptions } from "./options.js";
import { builtinPlugins } from "./plugins.js";
import { addReference, attachReferences } from "./references.js";
import { renderSafeMarkdown } from "./markdown.js";
import { WKT_NOTES } from "./wkt.js";

export type { SourceLinkConfig };

export interface BuildModelOptions {
  title: string;
  inputLabel: string;
  classification: ClassificationConfig;
  source?: SourceLinkConfig;
  sourceTexts?: Record<string, string>;
  plugins?: ProtolensPlugin[];
  timings?: Record<string, number>;
  warnings?: string[];
  commit?: string;
}

const FILE_MESSAGE_TYPE = 4;
const FILE_ENUM_TYPE = 5;
const FILE_SERVICE = 6;
const FILE_EXTENSION = 7;
const DESC_FIELD = 2;
const DESC_NESTED = 3;
const DESC_ENUM = 4;
const DESC_EXT = 6;
const DESC_ONEOF = 8;
const ENUM_VALUE = 2;
const SERVICE_METHOD = 2;

export function buildModel(registry: FileRegistry, options: BuildModelOptions): SchemaModel {
  const plugins = [...builtinPlugins, ...(options.plugins ?? [])];
  const renderers = plugins.flatMap((plugin) => plugin.semanticOptionRenderers ?? []);
  const optionExtensions = collectOptionExtensions(registry);
  const warnings = [...(options.warnings ?? [])];

  const packages = new Map<string, DocPackage>();
  const files: DocFile[] = [];
  const messages: DocMessage[] = [];
  const fields: DocField[] = [];
  const oneofs: DocOneof[] = [];
  const enums: DocEnum[] = [];
  const enumValues: DocEnumValue[] = [];
  const services: DocService[] = [];
  const methods: DocMethod[] = [];
  const extensions: DocExtension[] = [];
  const symbols: Record<string, DocSymbol> = {};
  const byFullName: Record<string, string> = {};
  const forward: SymbolReference[] = [];
  const fileClass = new Map<string, ReturnType<typeof classifyFile>>();

  const remember = (symbol: DocSymbol) => {
    symbols[symbol.id] = symbol;
    byFullName[`${symbol.kind}:${symbol.fullName}`] = symbol.id;
    if (symbol.kind !== "field" && symbol.kind !== "enum-value" && symbol.kind !== "method" && symbol.kind !== "oneof") {
      byFullName[symbol.fullName] = symbol.id;
    }
  };

  for (const file of registry.files) {
    const packageName = file.proto.package || "";
    const classification = classifyFile(file.name + ".proto", packageName, options.classification);
    fileClass.set(file.name, classification);

    const locIndex = indexLocations(file.proto.sourceCodeInfo?.location);
    const fileName = file.proto.name || `${file.name}.proto`;
    const hasLocalSource = Boolean(options.sourceTexts?.[fileName]);
    const fileComments = locationToComment(locIndex.get("")) ?? locationToComment(locIndex.get("2"));
    const syntax = fileSyntax(file);
    const { urlPath } = urlPathFor("file", fileName);
    const docFile: DocFile = {
      id: fileId(fileName),
      kind: "file",
      fullName: fileName,
      shortName: fileName.split("/").pop() ?? fileName,
      packageName,
      fileName,
      domain: classification.domain,
      generatePage: classification.generatePage && Boolean(options.sourceTexts?.[fileName]),
      inNav: false,
      deprecated: file.deprecated,
      comments: fileComments,
      source: locationToSource(fileName, locIndex.get("")),
      ...sourceRefs(fileName, locationToSource(fileName, locIndex.get("")), options.source, hasLocalSource),
      options: extractOptions(file.proto.options, "file", optionExtensions, registry, renderers, {
        id: fileId(fileName),
      }),
      references: [],
      referencedBy: [],
      urlPath,
      features: [],
      syntax,
      edition: syntax === "editions" ? editionLabel(file.edition) : undefined,
      dependencyIds: file.dependencies.map((dep) => fileId(dep.proto.name || `${dep.name}.proto`)),
      publicDependencyIds: [],
      goPackage: file.proto.options?.goPackage || undefined,
      javaPackage: file.proto.options?.javaPackage || undefined,
      csharpNamespace: file.proto.options?.csharpNamespace || undefined,
      sourceText: options.sourceTexts?.[fileName],
    };
    files.push(docFile);
    remember(docFile);

    ensurePackage(packages, packageName, classification, remember, fileComments);

    const pkg = packages.get(packageName)!;
    pkg.fileIds.push(docFile.id);

    for (const dep of file.dependencies) {
      addReference(forward, "file-import", docFile.id, fileId(dep.proto.name || `${dep.name}.proto`));
    }

    file.messages.forEach((message, index) => {
      walkMessage(message, [FILE_MESSAGE_TYPE, index], undefined);
    });
    file.enums.forEach((enumDesc, index) => {
      walkEnum(enumDesc, [FILE_ENUM_TYPE, index], undefined);
    });
    file.extensions.forEach((ext, index) => {
      walkExtension(ext, [FILE_EXTENSION, index]);
    });
    file.services.forEach((service, index) => {
      walkService(service, [FILE_SERVICE, index]);
    });

    function walkMessage(message: DescMessage, path: number[], parent: DescMessage | undefined): void {
      if (message.proto.options?.mapEntry) {
        return;
      }
      const classification = fileClass.get(file.name)!;
      const loc = commentsFor(locIndex, path);
      const id = symbolId("message", message.typeName);
      const { urlPath } = urlPathFor("message", message.typeName);
      const doc: DocMessage = {
        id,
        kind: "message",
        fullName: message.typeName,
        shortName: message.name,
        packageName,
        fileName,
        domain: classification.domain,
        generatePage: classification.generatePage,
        inNav: classification.inNav && !parent,
        deprecated: message.deprecated,
        comments: loc.comments,
        source: loc.source ? { ...loc.source, fileName } : undefined,
        ...sourceRefs(fileName, loc.source ? { ...loc.source, fileName } : undefined, options.source, hasLocalSource),
        options: extractOptions(message.proto.options, "message", optionExtensions, registry, renderers, { id }),
        references: [],
        referencedBy: [],
        urlPath,
        features: messageFeatures(message),
        parentId: parent ? symbolId("message", parent.typeName) : undefined,
        fieldIds: [],
        oneofIds: [],
        nestedMessageIds: [],
        nestedEnumIds: [],
        nestedExtensionIds: [],
        extensionRanges: (message.proto.extensionRange ?? []).map((range) => ({
          start: range.start,
          end: range.end,
        })),
        reservedRanges: (message.proto.reservedRange ?? []).map((range) => ({
          start: range.start,
          end: range.end,
        })),
        reservedNames: [...(message.proto.reservedName ?? [])],
        mapEntry: false,
      };
      messages.push(doc);
      remember(doc);
      pkg.messageIds.push(id);
      if (parent) {
        addReference(forward, "nested-type", symbolId("message", parent.typeName), id);
      }

      message.oneofs.forEach((oneof, oneofIndex) => {
        const oneofPath = [...path, DESC_ONEOF, oneofIndex];
        const oneofLoc = commentsFor(locIndex, oneofPath);
        const oid = oneofId(message.typeName, oneof.name);
        const url = urlPathFor("oneof", `${message.typeName}.${oneof.name}`, message.typeName);
        const docOneof: DocOneof = {
          id: oid,
          kind: "oneof",
          fullName: `${message.typeName}.${oneof.name}`,
          shortName: oneof.name,
          packageName,
          fileName,
          domain: classification.domain,
          generatePage: false,
          inNav: false,
          deprecated: false,
          comments: oneofLoc.comments,
          source: oneofLoc.source ? { ...oneofLoc.source, fileName } : undefined,
          options: extractOptions(oneof.proto.options, "oneof", optionExtensions, registry, renderers, { id: oid }),
          references: [],
          referencedBy: [],
          urlPath: url.urlPath,
          anchor: url.anchor,
          features: [],
          parentId: id,
          fieldIds: [],
        };
        oneofs.push(docOneof);
        remember(docOneof);
        doc.oneofIds.push(oid);
      });

      message.fields.forEach((field, fieldIndex) => {
        const fieldPath = [...path, DESC_FIELD, fieldIndex];
        const fieldLoc = commentsFor(locIndex, fieldPath);
        const fid = fieldId(message.typeName, field.name);
        const url = urlPathFor("field", `${message.typeName}.${field.name}`, message.typeName);
        const typeRef = typeRefFor(field, classification.domain);
        const docField: DocField = {
          id: fid,
          kind: "field",
          fullName: `${message.typeName}.${field.name}`,
          shortName: field.name,
          packageName,
          fileName,
          domain: classification.domain,
          generatePage: false,
          inNav: false,
          deprecated: field.deprecated,
          comments: fieldLoc.comments,
          source: fieldLoc.source ? { ...fieldLoc.source, fileName } : undefined,
          ...sourceRefs(
            fileName,
            fieldLoc.source ? { ...fieldLoc.source, fileName } : undefined,
            options.source,
            hasLocalSource,
          ),
          options: extractOptions(field.proto.options, "field", optionExtensions, registry, renderers, { id: fid }),
          references: [],
          referencedBy: [],
          urlPath: url.urlPath,
          anchor: url.anchor,
          features: fieldFeatures(field),
          parentId: id,
          number: field.number,
          jsonName: field.jsonName,
          cardinality: cardinalityOf(field),
          type: typeRef,
          mapKey: field.fieldKind === "map" ? { kind: "scalar", name: scalarName(field.mapKey) } : undefined,
          mapValue: field.fieldKind === "map" ? mapValueRef(field) : undefined,
          oneofId: field.oneof ? oneofId(message.typeName, field.oneof.name) : undefined,
          packed: field.fieldKind === "list" ? field.packed : undefined,
          defaultValue: defaultValueOf(field),
          presence: presenceLabel(field),
        };
        fields.push(docField);
        remember(docField);
        doc.fieldIds.push(fid);
        if (docField.oneofId) {
          const oneof = oneofs.find((item) => item.id === docField.oneofId);
          oneof?.fieldIds.push(fid);
        }
        linkType(fid, typeRef, "field-type");
        if (docField.mapKey) {
          linkType(fid, docField.mapKey, "map-key-type");
        }
        if (docField.mapValue) {
          linkType(fid, docField.mapValue, "map-value-type");
        }
        for (const option of docField.options) {
          if (option.definitionId) {
            addReference(forward, "option-definition", fid, option.definitionId, option.fullName);
          }
        }
      });

      message.nestedMessages.forEach((nested, nestedIndex) => {
        walkMessage(nested, [...path, DESC_NESTED, nestedIndex], message);
        if (!nested.proto.options?.mapEntry) {
          doc.nestedMessageIds.push(symbolId("message", nested.typeName));
        }
      });
      message.nestedEnums.forEach((nested, nestedIndex) => {
        walkEnum(nested, [...path, DESC_ENUM, nestedIndex], message);
        doc.nestedEnumIds.push(symbolId("enum", nested.typeName));
      });
      message.nestedExtensions.forEach((nested, nestedIndex) => {
        walkExtension(nested, [...path, DESC_EXT, nestedIndex]);
        doc.nestedExtensionIds.push(symbolId("extension", nested.typeName));
      });
    }

    function walkEnum(enumDesc: DescEnum, path: number[], parent: DescMessage | undefined): void {
      const classification = fileClass.get(file.name)!;
      const loc = commentsFor(locIndex, path);
      const id = symbolId("enum", enumDesc.typeName);
      const { urlPath } = urlPathFor("enum", enumDesc.typeName);
      const doc: DocEnum = {
        id,
        kind: "enum",
        fullName: enumDesc.typeName,
        shortName: enumDesc.name,
        packageName,
        fileName,
        domain: classification.domain,
        generatePage: classification.generatePage,
        inNav: classification.inNav && !parent,
        deprecated: enumDesc.deprecated,
        comments: loc.comments,
        source: loc.source ? { ...loc.source, fileName } : undefined,
        ...sourceRefs(fileName, loc.source ? { ...loc.source, fileName } : undefined, options.source, hasLocalSource),
        options: extractOptions(enumDesc.proto.options, "enum", optionExtensions, registry, renderers, { id }),
        references: [],
        referencedBy: [],
        urlPath,
        features: enumFeatures(enumDesc),
        parentId: parent ? symbolId("message", parent.typeName) : undefined,
        open: enumDesc.open,
        allowAlias: Boolean(enumDesc.proto.options?.allowAlias),
        valueIds: [],
        reservedRanges: (enumDesc.proto.reservedRange ?? []).map((range) => ({
          start: range.start,
          end: range.end,
        })),
        reservedNames: [...(enumDesc.proto.reservedName ?? [])],
      };
      enums.push(doc);
      remember(doc);
      pkg.enumIds.push(id);
      if (parent) {
        addReference(forward, "nested-type", symbolId("message", parent.typeName), id);
      }
      enumDesc.values.forEach((value, valueIndex) => {
        const valueLoc = commentsFor(locIndex, [...path, ENUM_VALUE, valueIndex]);
        const vid = enumValueId(enumDesc.typeName, value.name);
        const url = urlPathFor("enum-value", `${enumDesc.typeName}.${value.name}`, enumDesc.typeName);
        const docValue: DocEnumValue = {
          id: vid,
          kind: "enum-value",
          fullName: `${enumDesc.typeName}.${value.name}`,
          shortName: value.name,
          packageName,
          fileName,
          domain: classification.domain,
          generatePage: false,
          inNav: false,
          deprecated: value.deprecated,
          comments: valueLoc.comments,
          source: valueLoc.source ? { ...valueLoc.source, fileName } : undefined,
          options: extractOptions(value.proto.options, "enum-value", optionExtensions, registry, renderers, {
            id: vid,
          }),
          references: [],
          referencedBy: [],
          urlPath: url.urlPath,
          anchor: url.anchor,
          features: [],
          parentId: id,
          number: value.number,
        };
        enumValues.push(docValue);
        remember(docValue);
        doc.valueIds.push(vid);
        for (const option of docValue.options) {
          if (option.definitionId) {
            addReference(forward, "option-definition", vid, option.definitionId, option.fullName);
          }
        }
      });
    }

    function walkExtension(ext: DescExtension, path: number[]): void {
      const classification = fileClass.get(file.name)!;
      const loc = commentsFor(locIndex, path);
      const id = symbolId("extension", ext.typeName);
      const { urlPath } = urlPathFor("extension", ext.typeName);
      const extendee: TypeRef = {
        kind: "message",
        name: ext.extendee.typeName,
        id: symbolId("message", ext.extendee.typeName),
      };
      const type = extensionTypeRef(ext);
      const optionTarget = OPTION_TARGET[ext.extendee.typeName];
      const doc: DocExtension = {
        id,
        kind: "extension",
        fullName: ext.typeName,
        shortName: ext.name,
        packageName,
        fileName,
        domain: classification.domain,
        generatePage: classification.generatePage || Boolean(optionTarget),
        inNav: classification.inNav,
        deprecated: ext.deprecated,
        comments: loc.comments,
        source: loc.source ? { ...loc.source, fileName } : undefined,
        ...sourceRefs(fileName, loc.source ? { ...loc.source, fileName } : undefined, options.source, hasLocalSource),
        options: extractOptions(ext.proto.options, "field", optionExtensions, registry, renderers, { id }),
        references: [],
        referencedBy: [],
        urlPath,
        features: extensionFeatures(ext),
        number: ext.number,
        extendee,
        type,
        optionTarget,
        declaration: formatExtensionDeclaration(ext, type),
      };
      extensions.push(doc);
      remember(doc);
      pkg.extensionIds.push(id);
      addReference(forward, "extension-target", id, extendee.id ?? "", "extends");
      linkType(id, type, "field-type");
    }

    function walkService(service: DescService, path: number[]): void {
      const classification = fileClass.get(file.name)!;
      const loc = commentsFor(locIndex, path);
      const id = symbolId("service", service.typeName);
      const { urlPath } = urlPathFor("service", service.typeName);
      const doc: DocService = {
        id,
        kind: "service",
        fullName: service.typeName,
        shortName: service.name,
        packageName,
        fileName,
        domain: classification.domain,
        generatePage: classification.generatePage,
        inNav: classification.inNav,
        deprecated: service.deprecated,
        comments: loc.comments,
        source: loc.source ? { ...loc.source, fileName } : undefined,
        ...sourceRefs(fileName, loc.source ? { ...loc.source, fileName } : undefined, options.source, hasLocalSource),
        options: extractOptions(service.proto.options, "service", optionExtensions, registry, renderers, { id }),
        references: [],
        referencedBy: [],
        urlPath,
        features: [],
        methodIds: [],
      };
      services.push(doc);
      remember(doc);
      pkg.serviceIds.push(id);

      service.methods.forEach((method, methodIndex) => {
        const methodLoc = commentsFor(locIndex, [...path, SERVICE_METHOD, methodIndex]);
        const mid = methodId(service.typeName, method.name);
        const url = urlPathFor("method", `${service.typeName}.${method.name}`, service.typeName);
        const input = messageRef(method.input);
        const output = messageRef(method.output);
        const docMethod: DocMethod = {
          id: mid,
          kind: "method",
          fullName: `${service.typeName}.${method.name}`,
          shortName: method.name,
          packageName,
          fileName,
          domain: classification.domain,
          generatePage: false,
          inNav: false,
          deprecated: method.deprecated,
          comments: methodLoc.comments,
          source: methodLoc.source ? { ...methodLoc.source, fileName } : undefined,
          ...sourceRefs(
            fileName,
            methodLoc.source ? { ...methodLoc.source, fileName } : undefined,
            options.source,
            hasLocalSource,
          ),
          options: extractOptions(method.proto.options, "method", optionExtensions, registry, renderers, { id: mid }),
          references: [],
          referencedBy: [],
          urlPath: url.urlPath,
          anchor: url.anchor,
          features: [],
          parentId: id,
          input,
          output,
          clientStreaming: method.methodKind === "client_streaming" || method.methodKind === "bidi_streaming",
          serverStreaming: method.methodKind === "server_streaming" || method.methodKind === "bidi_streaming",
          streamingKind: method.methodKind,
          idempotency: idempotencyName(method.idempotency),
          signature: formatSignature(method),
        };
        methods.push(docMethod);
        remember(docMethod);
        doc.methodIds.push(mid);
        addReference(forward, "rpc-input", mid, input.id ?? "", "request");
        addReference(forward, "rpc-output", mid, output.id ?? "", "response");
        for (const option of docMethod.options) {
          if (option.definitionId) {
            addReference(forward, "option-definition", mid, option.definitionId, option.fullName);
          }
        }
      });
    }

    function typeRefFor(field: DescField, domain: DocSymbol["domain"]): TypeRef {
      if (field.fieldKind === "scalar") {
        return { kind: "scalar", name: scalarName(field.scalar) };
      }
      if (field.fieldKind === "enum" || (field.fieldKind === "list" && field.listKind === "enum")) {
        return namedRef("enum", field.enum!.typeName, domain);
      }
      if (field.fieldKind === "message" || (field.fieldKind === "list" && field.listKind === "message")) {
        return namedRef("message", field.message!.typeName, domain);
      }
      if (field.fieldKind === "map") {
        if (field.mapKind === "enum") {
          return namedRef("enum", field.enum!.typeName, domain);
        }
        if (field.mapKind === "message") {
          return namedRef("message", field.message!.typeName, domain);
        }
        return { kind: "scalar", name: scalarName(field.scalar) };
      }
      if (field.fieldKind === "list" && field.listKind === "scalar") {
        return { kind: "scalar", name: scalarName(field.scalar) };
      }
      return { kind: "scalar", name: "string" };
    }

    function mapValueRef(field: DescField): TypeRef {
      if (field.fieldKind !== "map") {
        return { kind: "scalar", name: "string" };
      }
      if (field.mapKind === "message") {
        return namedRef("message", field.message.typeName, "local");
      }
      if (field.mapKind === "enum") {
        return namedRef("enum", field.enum.typeName, "local");
      }
      return { kind: "scalar", name: scalarName(field.scalar) };
    }

    function namedRef(kind: "message" | "enum", typeName: string, _domain: DocSymbol["domain"]): TypeRef {
      const id = symbolId(kind, typeName);
      const url = urlPathFor(kind, typeName);
      const externalUrl = resolveExternalUrl(typeName, kind, options.classification);
      return {
        kind,
        name: typeName,
        id,
        urlPath: externalUrl ? undefined : url.urlPath,
        externalUrl,
      };
    }

    function messageRef(message: DescMessage): TypeRef {
      return namedRef("message", message.typeName, "local");
    }

    function extensionTypeRef(ext: DescExtension): TypeRef {
      if (ext.fieldKind === "scalar") {
        return { kind: "scalar", name: scalarName(ext.scalar) };
      }
      if (ext.fieldKind === "enum" || (ext.fieldKind === "list" && ext.listKind === "enum")) {
        return namedRef("enum", ext.enum!.typeName, "local");
      }
      if (ext.fieldKind === "message" || (ext.fieldKind === "list" && ext.listKind === "message")) {
        return namedRef("message", ext.message!.typeName, "local");
      }
      if (ext.fieldKind === "list" && ext.listKind === "scalar") {
        return { kind: "scalar", name: scalarName(ext.scalar) };
      }
      return { kind: "scalar", name: "string" };
    }

    function linkType(fromId: string, type: TypeRef, kind: SymbolReference["kind"]): void {
      if (type.id) {
        addReference(forward, kind, fromId, type.id);
      }
    }
  }

  for (const message of messages) {
    if (message.generatePage && !message.inNav && message.domain === "external-undocumented") {
      const used = forward.some((ref) => ref.toId === message.id);
      if (used) {
        message.generatePage = true;
      }
    }
  }

  const wktNotes: Record<string, string> = {};
  for (const [typeName, note] of Object.entries(WKT_NOTES)) {
    wktNotes[typeName] = renderSafeMarkdown(note);
  }

  const model: SchemaModel = {
    title: options.title,
    packages: [...packages.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    files: sortByName(files),
    messages: sortByName(messages),
    fields: sortByName(fields),
    oneofs: sortByName(oneofs),
    enums: sortByName(enums),
    enumValues: sortByName(enumValues),
    services: sortByName(services),
    methods: sortByName(methods),
    extensions: sortByName(extensions),
    symbols,
    byFullName,
    symbolIndex: [],
    buildInfo: {
      title: options.title,
      generatedAt: new Date().toISOString(),
      generator: "protolens",
      input: options.inputLabel,
      commit: options.commit,
      repository: options.source?.repository,
      symbolCount: Object.keys(symbols).length,
      fileCount: files.length,
      timings: options.timings ?? {},
      warnings,
    },
    wktNotes,
  };

  attachReferences(model, forward);

  for (const message of model.messages) {
    if (!message.mapEntry) {
      message.exampleJson = buildExampleJson(message, model);
      message.exampleTextProto = buildExampleTextProto(message, model);
    }
  }

  promoteReferencedPages(model);

  for (const plugin of plugins) {
    for (const transform of plugin.modelTransforms ?? []) {
      transform.transform(model);
    }
  }

  model.symbolIndex = buildSymbolIndex(model);
  model.buildInfo.symbolCount = Object.keys(model.symbols).length;
  return model;
}

function ensurePackage(
  packages: Map<string, DocPackage>,
  packageName: string,
  classification: ReturnType<typeof classifyFile>,
  remember: (symbol: DocSymbol) => void,
  comments?: DocComment,
): void {
  const name = packageName || "(unnamed)";
  if (packages.has(packageName)) {
    const existing = packages.get(packageName)!;
    if (classification.generatePage) {
      existing.generatePage = true;
    }
    if (classification.inNav) {
      existing.inNav = true;
    }
    if (classification.domain === "local") {
      existing.domain = "local";
    }
    return;
  }
  const { urlPath } = urlPathFor("package", name);
  const doc: DocPackage = {
    id: packageId(name),
    kind: "package",
    fullName: name,
    shortName: name,
    packageName: name,
    fileName: "",
    domain: classification.domain,
    generatePage: classification.generatePage,
    inNav: classification.inNav,
    deprecated: false,
    comments,
    options: [],
    references: [],
    referencedBy: [],
    urlPath,
    features: [],
    serviceIds: [],
    messageIds: [],
    enumIds: [],
    extensionIds: [],
    fileIds: [],
  };
  packages.set(packageName, doc);
  remember(doc);
}

function promoteReferencedPages(model: SchemaModel): void {
  const pageKinds: SymbolKind[] = ["message", "enum", "service", "extension"];
  for (const symbol of Object.values(model.symbols)) {
    if (!pageKinds.includes(symbol.kind) || symbol.generatePage) {
      continue;
    }
    const referencedFromDocumented = symbol.referencedBy.some((ref) => {
      const from = model.symbols[ref.fromId];
      return from && (from.generatePage || from.domain === "local");
    });
    if (referencedFromDocumented && symbol.domain !== "external-documented" && symbol.domain !== "well-known") {
      symbol.generatePage = true;
      symbol.inNav = false;
    }
  }
}

function buildSymbolIndex(model: SchemaModel): SymbolIndexEntry[] {
  const kinds: Array<keyof SchemaModel> = [
    "packages",
    "services",
    "methods",
    "messages",
    "fields",
    "enums",
    "enumValues",
    "extensions",
    "files",
  ];
  const entries: SymbolIndexEntry[] = [];
  for (const key of kinds) {
    const list = model[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const symbol of list as DocSymbol[]) {
      if (symbol.kind === "message" && (symbol as DocMessage).mapEntry) {
        continue;
      }
      entries.push({
        id: symbol.id,
        name: symbol.shortName,
        fullName: symbol.fullName,
        kind: symbol.kind,
        package: symbol.packageName,
        urlPath: href(symbol.urlPath, symbol.anchor),
      });
    }
  }
  entries.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return entries;
}

function cardinalityOf(field: DescField): Cardinality {
  if (field.fieldKind === "map") {
    return "map";
  }
  if (field.fieldKind === "list") {
    return "repeated";
  }
  if (field.presence === 3) {
    return "required";
  }
  if (field.presence === 1) {
    return "optional";
  }
  return "implicit";
}

function presenceLabel(field: DescField): string {
  switch (field.presence) {
    case 1:
      return "EXPLICIT";
    case 2:
      return "IMPLICIT";
    case 3:
      return "LEGACY_REQUIRED";
    default:
      return String(field.presence);
  }
}

function defaultValueOf(field: DescField): string | undefined {
  if (field.fieldKind !== "scalar" && field.fieldKind !== "enum") {
    return undefined;
  }
  const value = field.getDefaultValue();
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Uint8Array) {
    return `<${value.length} bytes>`;
  }
  return String(value);
}

function scalarName(type: ScalarType | number): ScalarName {
  const names: Record<number, ScalarName> = {
    [ScalarType.DOUBLE]: "double",
    [ScalarType.FLOAT]: "float",
    [ScalarType.INT64]: "int64",
    [ScalarType.UINT64]: "uint64",
    [ScalarType.INT32]: "int32",
    [ScalarType.FIXED64]: "fixed64",
    [ScalarType.FIXED32]: "fixed32",
    [ScalarType.BOOL]: "bool",
    [ScalarType.STRING]: "string",
    [ScalarType.BYTES]: "bytes",
    [ScalarType.UINT32]: "uint32",
    [ScalarType.SFIXED32]: "sfixed32",
    [ScalarType.SFIXED64]: "sfixed64",
    [ScalarType.SINT32]: "sint32",
    [ScalarType.SINT64]: "sint64",
  };
  return names[type] ?? "string";
}

function formatSignature(method: DescMethod): string {
  const input =
    method.methodKind === "client_streaming" || method.methodKind === "bidi_streaming"
      ? `stream ${method.input.name}`
      : method.input.name;
  const output =
    method.methodKind === "server_streaming" || method.methodKind === "bidi_streaming"
      ? `stream ${method.output.name}`
      : method.output.name;
  return `rpc ${method.name}(${input}) returns (${output});`;
}

function formatExtensionDeclaration(ext: DescExtension, type: TypeRef): string {
  const typeName = ext.fieldKind === "list" ? `repeated ${type.name}` : type.name;
  return `extend ${ext.extendee.typeName} {\n  ${typeName} ${ext.name} = ${ext.number};\n}`;
}

function idempotencyName(value: MethodOptions_IdempotencyLevel): string | undefined {
  switch (value) {
    case MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS:
      return "NO_SIDE_EFFECTS";
    case MethodOptions_IdempotencyLevel.IDEMPOTENT:
      return "IDEMPOTENT";
    default:
      return undefined;
  }
}

function sourceRefs(
  fileName: string,
  source: { startLine: number; fileName?: string } | undefined,
  config: SourceLinkConfig | undefined,
  hasLocalSource: boolean,
): { sourceLink?: SourceLink; repositoryLink?: SourceLink } {
  const line = source?.startLine ?? 1;
  const repoUrl = repositoryBlobUrl(config, fileName, line);
  const repositoryLink = repoUrl ? { label: `${fileName}:${line}`, url: repoUrl } : undefined;
  if (hasLocalSource) {
    return {
      sourceLink: { label: `${fileName}:${line}`, url: fileSourcePath(fileName, line) },
      repositoryLink,
    };
  }
  return { sourceLink: repositoryLink };
}

function sortByName<T extends { fullName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

const OPTION_TARGET: Record<string, DocExtension["optionTarget"]> = {
  "google.protobuf.FileOptions": "file",
  "google.protobuf.MessageOptions": "message",
  "google.protobuf.FieldOptions": "field",
  "google.protobuf.OneofOptions": "oneof",
  "google.protobuf.EnumOptions": "enum",
  "google.protobuf.EnumValueOptions": "enum-value",
  "google.protobuf.ServiceOptions": "service",
  "google.protobuf.MethodOptions": "method",
};

// Keep nestedTypes imported so tree-shaking does not drop a useful runtime helper for plugins.
void nestedTypes;
