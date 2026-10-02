import { fieldTableEntries } from "../../../src/core/field-table.ts";
import type {
  DocEnum,
  DocExtension,
  DocField,
  DocMessage,
  DocMethod,
  DocOneof,
  DocOption,
  DocPackage,
  DocService,
  DocSymbol,
  EffectiveFeature,
  ReservedRange,
  SchemaDiff,
  SymbolIndexEntry,
  SymbolReference,
  TypeRef,
} from "../../../src/core/types.ts";
import { kindLabel, relationLabel } from "./labels.ts";
import { isExternalHref, repositoryLinkLabel } from "./repository-link.ts";

export type Href = (urlPath: string) => string;

export interface PageLink {
  id: string;
  name: string;
  fullName: string;
  urlPath: string;
  kind: string;
  shard?: string;
}

export interface NamedPage {
  fullName: string;
  urlPath: string;
  generatePage: boolean;
}

export interface PageContext {
  href: Href;
  byId: ReadonlyMap<string, PageLink>;
  packageByName: ReadonlyMap<string, NamedPage>;
  fileByName: ReadonlyMap<string, NamedPage & { hasSource: boolean }>;
}

const VALIDATION_RENDERERS = new Set(["validation", "cybozu.validate"]);

function esc(value: string | number | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isValidation(id: string | undefined): boolean {
  return id !== undefined && VALIDATION_RENDERERS.has(id);
}

function validationChips(options: DocOption[] | undefined): string[] {
  const chips: string[] = [];
  for (const option of options ?? []) {
    const semantic = option.semantic;
    if (!isValidation(semantic?.rendererId)) continue;
    if (semantic?.badges?.length) chips.push(...semantic.badges);
    else if (semantic?.summary) chips.push(semantic.summary);
  }
  return chips;
}

function chips(values: string[]): string {
  if (!values.length) return `<span class="text-[color:var(--fg-muted)]">—</span>`;
  return `<div class="flex flex-wrap gap-1">${values.map((chip) => `<span class="validation-chip">${esc(chip)}</span>`).join("")}</div>`;
}

function commentHtml(symbol: DocSymbol | undefined): string {
  const html = symbol?.comments?.markdownHtml;
  return html ? `<div class="prose-doc text-sm">${html}</div>` : `<span class="text-[color:var(--fg-muted)]">—</span>`;
}

function typeHref(ref: TypeRef | undefined, href: Href): string | undefined {
  if (!ref) return undefined;
  if (ref.externalUrl) return ref.externalUrl;
  if (ref.urlPath) return href(ref.urlPath);
  return undefined;
}

function typeLabel(field: DocField): string {
  if (field.cardinality === "map") {
    return `map<${field.mapKey?.name ?? "string"}, ${field.mapValue?.name ?? "string"}>`;
  }
  return field.type.name;
}

function linkedType(ref: TypeRef | undefined, href: Href, label?: string): string {
  const text = esc(label ?? ref?.name ?? "");
  const url = typeHref(ref, href);
  return url ? `<a href="${esc(url)}">${text}</a>` : text;
}

function domId(anchor: string | undefined, prefix: string): string {
  return anchor ? `${prefix}${anchor}` : "";
}

function idsOf<T>(ids: string[] | undefined, related: Record<string, DocSymbol>): T[] {
  return (ids ?? []).map((id) => related[id] as T | undefined).filter((item): item is T => Boolean(item));
}

function linkFor(entry: PageLink | undefined, href: Href, label: string): string {
  if (!entry) return `<span class="font-mono">${esc(label)}</span>`;
  if (!entry.urlPath) return `<span class="font-mono">${esc(entry.fullName)}</span>`;
  return `<a href="${esc(href(entry.urlPath))}">${esc(entry.fullName)}</a>`;
}

export function symbolHeaderHtml(symbol: DocSymbol, ctx: PageContext): string {
  const pkg = symbol.packageName ? ctx.packageByName.get(symbol.packageName) : undefined;
  const file = symbol.fileName ? ctx.fileByName.get(symbol.fileName) : undefined;
  const packageChip = symbol.packageName
    ? pkg?.generatePage
      ? `<a class="rounded-full bg-[color:var(--bg-muted)] px-2 py-0.5 no-underline text-[color:var(--fg)]" href="${esc(ctx.href(pkg.urlPath))}">${esc(symbol.packageName)}</a>`
      : `<span class="rounded-full bg-[color:var(--bg-muted)] px-2 py-0.5">${esc(symbol.packageName)}</span>`
    : "";
  const fileChip = symbol.fileName
    ? file?.hasSource
      ? `<a class="rounded-full bg-[color:var(--bg-muted)] px-2 py-0.5 no-underline text-[color:var(--fg)]" href="${esc(ctx.href(file.urlPath))}">${esc(symbol.fileName)}</a>`
      : `<span class="rounded-full bg-[color:var(--bg-muted)] px-2 py-0.5">${esc(symbol.fileName)}</span>`
    : "";
  const source = symbol.sourceLink
    ? `<a class="rounded-full border border-[color:var(--line)] px-2 py-0.5 no-underline text-[color:var(--fg)]" href="${esc(isExternalHref(symbol.sourceLink.url) ? symbol.sourceLink.url : ctx.href(symbol.sourceLink.url))}">View source</a>`
    : "";
  const repo = symbol.repositoryLink
    ? `<a class="rounded-full border border-[color:var(--line)] px-2 py-0.5 no-underline text-[color:var(--fg)]" href="${esc(symbol.repositoryLink.url)}" rel="noopener noreferrer">${esc(repositoryLinkLabel(symbol.repositoryLink.url))}</a>`
    : "";
  const deprecated = symbol.deprecated
    ? `<span class="rounded-full bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 px-2 py-0.5">deprecated</span>`
    : "";
  const comment = symbol.comments?.markdownHtml
    ? `<div class="prose-doc mt-5 text-[0.98rem] leading-7">${symbol.comments.markdownHtml}</div>`
    : "";
  return `<header class="mb-8"><div class="text-xs font-semibold uppercase tracking-wider kind-${esc(symbol.kind)}">${esc(kindLabel(symbol.kind))}</div><h1 class="text-3xl font-semibold mt-1 break-all">${esc(symbol.shortName)}</h1><p class="font-mono text-sm text-[color:var(--fg-muted)] mt-2 break-all">${esc(symbol.fullName)}</p><div class="flex flex-wrap gap-2 mt-3 text-xs">${deprecated}<span class="rounded-full bg-[color:var(--bg-muted)] px-2 py-0.5">${esc(symbol.domain)}</span>${packageChip}${fileChip}${source}${repo}</div>${comment}</header>`;
}

export function noteHtml(note: string | undefined): string {
  if (!note) return "";
  return `<aside class="rounded-xl border border-[color:var(--line)] bg-[color:var(--bg-muted)] p-4 mb-6 prose-doc text-sm">${note}</aside>`;
}

export function fieldTableHtml(fields: DocField[], oneofs: DocOneof[], href: Href, anchorPrefix = ""): string {
  const entries = fieldTableEntries(fields, oneofs);
  const rows = entries.map((entry) => (entry.kind === "oneof" ? oneofRows(entry.oneof, entry.members, href, anchorPrefix) : fieldRow(entry.field, href, anchorPrefix))).join("");
  const empty = fields.length
    ? ""
    : `<tr><td colspan="6" class="text-[color:var(--fg-muted)]">This message has no fields.</td></tr>`;
  return `<div class="table-wrap"><table class="fields schema-fields"><colgroup><col class="col-field" /><col class="col-number" /><col class="col-type" /><col class="col-cardinality" /><col class="col-validation" /><col class="col-description" /></colgroup><thead><tr><th>Field</th><th>Number</th><th>Type</th><th>Cardinality</th><th>Validation</th><th>Description</th></tr></thead><tbody>${rows}${empty}</tbody></table></div>`;
}

function oneofRows(oneof: DocOneof, members: DocField[], href: Href, prefix: string): string {
  const id = domId(oneof.anchor, prefix);
  const chipsFor = validationChips(oneof.options);
  const required = chipsFor.includes("required");
  const names = members
    .map((member, index) => `${index > 0 ? ", " : ""}<a href="#${esc(domId(member.anchor, prefix))}">${esc(member.shortName)}</a>`)
    .join("");
  const details = oneof.options.length
    ? `<details class="mt-2 text-xs"><summary class="cursor-pointer text-[color:var(--fg-muted)]">Details</summary><pre class="option mt-2">${oneof.options.map((option) => esc(option.textProto)).join("\n")}</pre></details>`
    : "";
  const head = `<tr id="${esc(id)}" class="oneof"><td><a class="font-mono no-underline text-[color:var(--fg)]" href="#${esc(id)}">${esc(oneof.shortName)}</a><div class="text-[11px] text-[color:var(--fg-muted)]">oneof</div></td><td class="text-[color:var(--fg-muted)]">—</td><td class="font-mono text-xs">oneof</td><td class="text-xs">${required ? "required" : "optional"}</td><td>${chips(chipsFor)}</td><td>${oneof.comments?.markdownHtml ? `<div class="prose-doc text-sm">${oneof.comments.markdownHtml}</div>` : ""}<p class="text-sm text-[color:var(--fg-muted)]">${required ? "Exactly one of " : "At most one of "}${names}.</p>${details}</td></tr>`;
  return head + members.map((field) => memberRow(field, oneof, href, prefix)).join("");
}

function memberRow(field: DocField, oneof: DocOneof, href: Href, prefix: string): string {
  const id = domId(field.anchor, prefix);
  const oneofId = domId(oneof.anchor, prefix);
  const target = field.cardinality === "map" ? field.mapValue : field.type;
  const deprecated = field.deprecated ? `<span class="ml-2 text-xs text-red-700">deprecated</span>` : "";
  return `<tr id="${esc(id)}" class="oneof-member"><td><a class="font-mono no-underline text-[color:var(--fg)]" href="#${esc(id)}">${esc(field.shortName)}</a>${deprecated}<div class="text-[11px] text-[color:var(--fg-muted)]">in <a href="#${esc(oneofId)}">${esc(oneof.shortName)}</a></div></td><td class="num">${field.number}</td><td class="font-mono text-xs">${linkedType(target, href, typeLabel(field))}</td><td class="text-xs">${esc(field.cardinality)}</td><td>${chips(validationChips(field.options))}</td><td>${commentHtml(field)}${fieldDetails(field)}</td></tr>`;
}

function fieldRow(field: DocField, href: Href, prefix: string): string {
  const id = domId(field.anchor, prefix);
  const target = field.cardinality === "map" ? field.mapValue : field.type;
  const deprecated = field.deprecated ? `<span class="ml-2 text-xs text-red-700">deprecated</span>` : "";
  return `<tr id="${esc(id)}"><td><a class="font-mono no-underline text-[color:var(--fg)]" href="#${esc(id)}">${esc(field.shortName)}</a>${deprecated}</td><td class="num">${field.number}</td><td class="font-mono text-xs">${linkedType(target, href, typeLabel(field))}</td><td class="text-xs">${esc(field.cardinality)}</td><td>${chips(validationChips(field.options))}</td><td>${commentHtml(field)}${fieldDetails(field)}</td></tr>`;
}

function fieldDetails(field: DocField): string {
  const annotations = field.options.flatMap((option) =>
    option.semantic && !isValidation(option.semantic.rendererId) ? (option.semantic.badges ?? []) : [],
  );
  const packed = field.packed !== undefined ? `<li>Packed: ${field.packed ? "true" : "false"}</li>` : "";
  const fallback = field.defaultValue ? `<li>Default: ${esc(field.defaultValue)}</li>` : "";
  const notes = annotations.length ? `<li>Annotations: ${esc(annotations.join(", "))}</li>` : "";
  const raw = field.options.length
    ? `<pre class="option mt-2">${field.options.map((option) => esc(option.textProto)).join("\n")}</pre>`
    : "";
  return `<details class="mt-2 text-xs"><summary class="cursor-pointer text-[color:var(--fg-muted)]">Details</summary><ul class="mt-2 space-y-1 text-[color:var(--fg-muted)]"><li>JSON name: <code>${esc(field.jsonName)}</code></li><li>Presence: ${esc(field.presence)}</li>${packed}${fallback}${notes}</ul>${raw}</details>`;
}

export function optionListHtml(options: DocOption[] | undefined, href: Href): string {
  const visible = (options ?? []).filter((option) => !(option.name === "deprecated" && option.value.kind === "scalar"));
  if (!visible.length) return "";
  const rows = visible
    .map((option) => {
      const open = option.semantic ? " open" : "";
      const summary = option.semantic
        ? `<span>${esc(option.semantic.title)}<span class="text-[color:var(--fg-muted)] font-normal"> — ${esc(option.semantic.summary)}</span></span>`
        : `<span class="font-mono text-sm">${esc(option.extension ? `(${option.fullName})` : option.name)}</span>`;
      const badges = option.semantic?.badges?.length
        ? `<div class="flex flex-wrap gap-1 mt-2">${option.semantic.badges.map((badge) => `<span class="text-xs rounded-full bg-[color:var(--bg-muted)] px-2 py-0.5">${esc(badge)}</span>`).join("")}</div>`
        : "";
      const defined = option.definitionId
        ? `<p class="text-sm mt-2">Defined by <a href="${esc(href(`/reference/extensions/${encodeURIComponent(option.fullName)}/`))}">${esc(option.fullName)}</a></p>`
        : "";
      return `<details class="rounded-xl border border-[color:var(--line)] bg-[color:var(--bg-raised)] p-4"${open}><summary class="cursor-pointer font-medium">${summary}</summary>${badges}${defined}<pre class="option mt-3">${esc(option.textProto)}</pre></details>`;
    })
    .join("");
  return `<section class="mt-8"><h2 class="text-lg font-semibold mb-3">Options</h2><div class="space-y-3">${rows}</div></section>`;
}

export function featureListHtml(features: EffectiveFeature[] | undefined): string {
  if (!features?.length) return "";
  const rows = features
    .map((feature) => {
      const source =
        feature.source === "declared" && feature.declared
          ? `declared ${feature.declared}`
          : feature.source === "inherited"
            ? `inherited from ${feature.inheritedFrom ?? "parent"}`
            : "default for this edition";
      return `<li class="rounded-lg border border-[color:var(--line)] px-3 py-2 bg-[color:var(--bg-raised)]"><div class="font-medium">${esc(feature.name)}: <span class="font-mono">${esc(feature.effective)}</span></div><div class="text-[color:var(--fg-muted)] text-xs mt-1">${esc(source)}</div></li>`;
    })
    .join("");
  return `<section class="mt-8"><h2 class="text-lg font-semibold mb-3">Effective features</h2><ul class="text-sm space-y-2">${rows}</ul></section>`;
}

export function usedByHtml(symbol: DocSymbol, ctx: PageContext): string {
  const grouped = new Map<string, SymbolReference[]>();
  for (const ref of symbol.referencedBy ?? []) {
    const list = grouped.get(ref.kind) ?? [];
    list.push(ref);
    grouped.set(ref.kind, list);
  }
  if (grouped.size === 0) {
    return `<section class="mt-10"><h2 class="text-lg font-semibold mb-2">Used by</h2><p class="text-sm text-[color:var(--fg-muted)]">No incoming references in this schema.</p></section>`;
  }
  const limit = 40;
  const groups = [...grouped.entries()]
    .map(([kind, refs]) => {
      const items = refs
        .slice(0, limit)
        .map((ref) => {
          const from = ctx.byId.get(ref.fromId);
          const body = linkFor(from, ctx.href, ref.fromId);
          const label = ref.label ? `<span class="text-[color:var(--fg-muted)]"> · ${esc(ref.label)}</span>` : "";
          return `<li>${body}${label}</li>`;
        })
        .join("");
      const more =
        refs.length > limit
          ? `<p class="text-xs text-[color:var(--fg-muted)] mt-2">Showing ${limit} of ${refs.length} references. Use the explorer to filter by package.</p>`
          : "";
      return `<div class="mb-4"><h3 class="text-sm font-semibold mb-2">${esc(relationLabel(kind as SymbolReference["kind"]))}</h3><ul class="space-y-1 text-sm">${items}</ul>${more}</div>`;
    })
    .join("");
  return `<section class="mt-10"><h2 class="text-lg font-semibold mb-3">Used by</h2><p class="text-sm text-[color:var(--fg-muted)] mb-4">What will be affected if this symbol changes.</p>${groups}</section>`;
}

function symbolList(title: string, ids: string[] | undefined, ctx: PageContext, label: (entry: PageLink) => string, empty: string): string {
  const entries = (ids ?? []).map((id) => ctx.byId.get(id)).filter((entry): entry is PageLink => Boolean(entry?.shard));
  const body = entries.length
    ? `<ul class="space-y-1">${entries.map((entry) => `<li><a href="${esc(ctx.href(entry.urlPath))}">${esc(label(entry))}</a></li>`).join("")}</ul>`
    : `<p class="text-sm text-[color:var(--fg-muted)]">${esc(empty)}</p>`;
  return `<section class="mt-8"><h2 class="text-lg font-semibold mb-2">${esc(title)}</h2>${body}</section>`;
}

export function packagePageHtml(pkg: DocPackage, ctx: PageContext): string {
  const comment = pkg.comments?.markdownHtml ? `<div class="prose-doc mt-4">${pkg.comments.markdownHtml}</div>` : "";
  const messages = (pkg.messageIds ?? [])
    .map((id) => ctx.byId.get(id))
    .filter((entry): entry is PageLink => Boolean(entry?.shard));
  const messageList = messages.length
    ? `<ul class="columns-1 sm:columns-2 gap-6 space-y-1">${messages.map((entry) => `<li><a href="${esc(ctx.href(entry.urlPath))}">${esc(entry.fullName.replace(`${pkg.fullName}.`, ""))}</a></li>`).join("")}</ul>`
    : "";
  const messageEmpty = messages.length ? "" : `<p class="text-sm text-[color:var(--fg-muted)]">No messages in this package.</p>`;
  return `
    <p class="text-xs uppercase tracking-wider text-[color:var(--accent)] font-semibold">Package</p>
    <h1 class="text-3xl font-semibold mt-1 break-all">${esc(pkg.fullName)}</h1>
    ${comment}
    ${symbolList("Services", pkg.serviceIds, ctx, (entry) => entry.name, "No services in this package.")}
    <section class="mt-8"><h2 class="text-lg font-semibold mb-2">Messages</h2>${messageList}${messageEmpty}</section>
    ${symbolList("Enums", pkg.enumIds, ctx, (entry) => entry.name, "No enums in this package.")}
    ${symbolList("Extensions", pkg.extensionIds, ctx, (entry) => entry.fullName, "No extensions in this package.")}
    ${optionListHtml(pkg.options, ctx.href)}
    ${usedByHtml(pkg, ctx)}
  `;
}

function nestedList(title: string, ids: string[] | undefined, related: Record<string, DocSymbol>, href: Href): string {
  const items = (ids ?? []).map((id) => related[id]).filter((item): item is DocSymbol => Boolean(item));
  if (!items.length) return "";
  return `<section class="mt-8"><h2 class="text-lg font-semibold mb-2">${esc(title)}</h2><ul>${items.map((item) => `<li><a href="${esc(href(item.anchor ? `${item.urlPath}#${item.anchor}` : item.urlPath))}">${esc(item.shortName)}</a></li>`).join("")}</ul></section>`;
}

function reservedHtml(names: string[] | undefined, ranges: ReservedRange[] | undefined): string {
  const nameList = names ?? [];
  const rangeList = ranges ?? [];
  if (!nameList.length && !rangeList.length) return "";
  const rangeText = rangeList.map((range) => `${range.start} to ${range.end - 1}`).join(", ");
  const nameText = nameList.join(", ");
  return `<section class="mt-8"><h2 class="text-lg font-semibold mb-2">Reserved</h2><p class="text-sm font-mono">${esc(rangeText)}${esc(nameText)}</p></section>`;
}

export function messagePageHtml(message: DocMessage, related: Record<string, DocSymbol>, note: string | undefined, ctx: PageContext): string {
  const fields = idsOf<DocField>(message.fieldIds, related);
  const oneofs = idsOf<DocOneof>(message.oneofIds, related);
  const parent = message.parentId ? ctx.byId.get(message.parentId) : undefined;
  const nested = parent
    ? `<p class="text-sm mb-4">Nested in ${linkFor(parent, ctx.href, parent.fullName)}</p>`
    : "";
  const example = message.exampleJson
    ? `<section class="mt-8"><h2 class="text-lg font-semibold mb-2">Example JSON</h2><pre class="option">${esc(JSON.stringify(message.exampleJson, null, 2))}</pre></section>`
    : "";
  return `${symbolHeaderHtml(message, ctx)}${noteHtml(note)}${nested}<h2 class="text-lg font-semibold mb-3">Fields</h2>${fieldTableHtml(fields, oneofs, ctx.href)}${nestedList("Nested messages", message.nestedMessageIds, related, ctx.href)}${nestedList("Nested enums", message.nestedEnumIds, related, ctx.href)}${reservedHtml(message.reservedNames, message.reservedRanges)}${example}${optionListHtml(message.options, ctx.href)}${featureListHtml(message.features)}${usedByHtml(message, ctx)}`;
}

export function enumPageHtml(doc: DocEnum, related: Record<string, DocSymbol>, note: string | undefined, ctx: PageContext): string {
  const rows = idsOf<DocSymbol & { number: number; deprecated: boolean }>(doc.valueIds, related)
    .map((value) => {
      const deprecated = value.deprecated ? `<span class="text-xs text-red-700 ml-2">deprecated</span>` : "";
      const description = value.comments?.markdownHtml ? `<div class="prose-doc text-sm">${value.comments.markdownHtml}</div>` : "—";
      return `<tr id="${esc(value.anchor ?? "")}"><td class="font-mono">${esc(value.shortName)}${deprecated}</td><td class="num">${value.number}</td><td>${description}</td></tr>`;
    })
    .join("");
  return `${symbolHeaderHtml(doc, ctx)}${noteHtml(note)}<p class="text-sm text-[color:var(--fg-muted)] mb-4">${doc.open ? "Open enum" : "Closed enum"}${doc.allowAlias ? " · aliases allowed" : ""}</p><div class="table-wrap"><table class="fields"><thead><tr><th>Value</th><th>Number</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>${optionListHtml(doc.options, ctx.href)}${featureListHtml(doc.features)}${usedByHtml(doc, ctx)}`;
}

export function servicePageHtml(service: DocService, related: Record<string, DocSymbol>, ctx: PageContext): string {
  const rows = idsOf<DocMethod>(service.methodIds, related)
    .map((method) => {
      const deprecated = method.deprecated ? `<div class="text-xs text-red-700">deprecated</div>` : "";
      const streaming =
        method.clientStreaming || method.serverStreaming
          ? `${method.clientStreaming ? `<span class="stream-chip">client</span>` : ""}${method.serverStreaming ? `<span class="stream-chip">server</span>` : ""}`
          : `<span class="text-[color:var(--fg-muted)]">unary</span>`;
      return `<tr><td><a class="font-mono no-underline text-[color:var(--fg)]" href="${esc(ctx.href(method.urlPath))}">${esc(method.shortName)}</a>${deprecated}</td><td class="font-mono text-xs">${linkedType(method.input, ctx.href)}</td><td class="font-mono text-xs">${linkedType(method.output, ctx.href)}</td><td class="text-xs"><span class="inline-flex flex-wrap gap-1">${streaming}</span></td></tr>`;
    })
    .join("");
  return `${symbolHeaderHtml(service, ctx)}<div class="table-wrap mb-8"><table class="fields"><thead><tr><th>RPC</th><th>Request</th><th>Response</th><th>Streaming</th></tr></thead><tbody>${rows}</tbody></table></div>${optionListHtml(service.options, ctx.href)}${usedByHtml(service, ctx)}`;
}

export function methodPageHtml(method: DocMethod, related: Record<string, DocSymbol>, ctx: PageContext): string {
  const service = ctx.byId.get(method.parentId);
  const serviceLine = service?.shard
    ? `<p class="text-sm -mt-4 mb-6">RPC on <a href="${esc(ctx.href(service.urlPath))}">${esc(service.name)}</a></p>`
    : "";
  const stream = (on: boolean) => (on ? `<span class="stream-keyword">stream</span> ` : "");
  const signature = `<pre class="proto">rpc ${esc(method.shortName)}(${stream(method.clientStreaming)}${esc(method.input.name)}) returns (${stream(method.serverStreaming)}${esc(method.output.name)});</pre>`;
  const idempotency = method.idempotency ? `<p class="text-sm text-[color:var(--fg-muted)] mt-3">${esc(method.idempotency)}</p>` : "";
  return `${symbolHeaderHtml(method, ctx)}${serviceLine}${signature}${idempotency}${optionListHtml(method.options, ctx.href)}${messageSection("Request", method.clientStreaming, method.input, related, ctx, "request-")}${messageSection("Response", method.serverStreaming, method.output, related, ctx, "response-")}`;
}

function messageSection(title: string, streaming: boolean, ref: TypeRef, related: Record<string, DocSymbol>, ctx: PageContext, prefix: string): string {
  const chip = streaming ? `<span class="stream-chip">stream</span>` : "";
  const message = ref.id ? (related[ref.id] as DocMessage | undefined) : undefined;
  const table =
    message && message.kind === "message"
      ? fieldTableHtml(idsOf<DocField>(message.fieldIds, related), idsOf<DocOneof>(message.oneofIds, related), ctx.href, prefix)
      : "";
  return `<section class="mt-8"><h2 class="text-lg font-semibold mb-2 flex items-center gap-2">${esc(title)} ${chip}</h2><p class="font-mono text-sm mb-3">${linkedType(ref, ctx.href)}</p>${table}</section>`;
}

export function extensionPageHtml(extension: DocExtension, ctx: PageContext): string {
  const kind = extension.optionTarget ? `${extension.optionTarget} option` : "extension";
  const card = (label: string, body: string) =>
    `<div class="rounded-xl border border-[color:var(--line)] p-3 bg-[color:var(--bg-raised)]"><dt class="text-[color:var(--fg-muted)]">${label}</dt><dd>${body}</dd></div>`;
  return `${symbolHeaderHtml(extension, ctx)}<dl class="grid sm:grid-cols-2 gap-3 text-sm mb-6">${card("Kind", esc(kind))}${card("Field number", `<span class="font-mono">${extension.number}</span>`)}${card("Extends", linkedType(extension.extendee, ctx.href))}${card("Type", linkedType(extension.type, ctx.href))}</dl><pre class="proto">${esc(extension.declaration)}</pre>${optionListHtml(extension.options, ctx.href)}${usedByHtml(extension, ctx)}`;
}

export function searchPageHtml(symbolCount: number, packageCount: number): string {
  return `<h1 class="text-3xl font-semibold mb-3">Search</h1><p class="text-[color:var(--fg-muted)] mb-6">Symbol search ranks exact protobuf names first. Full-text search covers comments, option values, and semantic notes. Use <kbd class="border border-[color:var(--line)] rounded px-1">/</kbd> from any page.</p><p class="text-sm">This schema indexes ${symbolCount} symbols across ${packageCount} packages.</p>`;
}

export function explorePageHtml(entries: PageLink[]): string {
  const options = [...entries]
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.kind.localeCompare(b.kind))
    .map((entry) => `<option value="${esc(entry.id)}">${esc(entry.kind)} · ${esc(entry.fullName)}</option>`)
    .join("");
  return `<h1 class="text-3xl font-semibold mb-3">Used-by explorer</h1><p class="text-[color:var(--fg-muted)] mb-6 max-w-2xl">Pick a documented symbol to see reverse references. This is the same graph used on each symbol page, without dumping thousands of Timestamp users into a single HTML blob.</p><label class="text-sm block mb-2" for="symbol-select">Symbol</label><select id="symbol-select" class="w-full max-w-xl rounded-md border border-[color:var(--line)] bg-[color:var(--bg-raised)] px-3 py-2"><option value="">Choose a symbol…</option>${options}</select><div id="explorer-out" class="mt-6 text-sm"></div>`;
}

export interface GraphViewNode {
  id: string;
  fullName: string;
  urlPath: string;
  generatePage: boolean;
}

export interface GraphViewEdge {
  from: string;
  to: string;
}

export function graphPageHtml(nodes: GraphViewNode[], edges: GraphViewEdge[], href: Href): string {
  const used = new Set<string>();
  for (const edge of edges) {
    used.add(edge.from);
    used.add(edge.to);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const cards = nodes.filter((node) => used.has(node.id))
    .map((node) => {
      const imports = [...new Set(edges.filter((edge) => edge.from === node.id).map((edge) => byId.get(edge.to)?.fullName ?? edge.to))].filter(
        (name) => name !== node.fullName,
      );
      const importedBy = [...new Set(edges.filter((edge) => edge.to === node.id).map((edge) => byId.get(edge.from)?.fullName ?? edge.from))].filter(
        (name) => name !== node.fullName,
      );
      const title = node.generatePage && node.urlPath ? `<a href="${esc(href(node.urlPath))}">${esc(node.fullName)}</a>` : esc(node.fullName);
      return `<li class="rounded-xl border border-[color:var(--line)] p-4 bg-[color:var(--bg-raised)]"><h2 class="font-semibold">${title}</h2><p class="text-sm mt-2"><span class="text-[color:var(--fg-muted)]">Imports:</span> ${imports.length ? esc(imports.join(", ")) : "none"}</p><p class="text-sm"><span class="text-[color:var(--fg-muted)]">Imported by:</span> ${importedBy.length ? esc(importedBy.join(", ")) : "none"}</p></li>`;
    })
    .join("");
  return `<h1 class="text-3xl font-semibold mb-3">Package graph</h1><p class="text-[color:var(--fg-muted)] mb-6">Imports between files, rolled up by package.</p><ul class="space-y-4">${cards}</ul>`;
}

export function diffPageHtml(diff: SchemaDiff | undefined): string {
  if (!diff) {
    return `<h1 class="text-3xl font-semibold mb-3">Schema diff</h1><p class="text-[color:var(--fg-muted)]">No comparison was attached to this build. Run <code>pbschema-lens diff --against previous.binpb</code> to generate this page.</p>`;
  }
  const breaking = diff.breaking ?? [];
  const compatibility = breaking.length
    ? `<section class="mb-8"><h2 class="text-lg font-semibold mb-2">Compatibility</h2><ul class="text-sm space-y-2">${breaking
        .map(
          (item) =>
            `<li class="rounded-lg border border-red-300 p-3"><div class="font-mono text-xs">${esc(item.rule)} · ${esc(item.categories.join(", "))}</div><div>${esc(item.message)}</div></li>`,
        )
        .join("")}</ul></section>`
    : "";
  const section = (title: string, items: SchemaDiff["added"], cls: string) => {
    const body = items.length
      ? `<ul class="text-sm space-y-2">${items
          .map(
            (item) =>
              `<li class="rounded-lg border border-[color:var(--line)] p-3 ${cls}"><div class="font-medium">${esc(item.kind)} ${esc(item.fullName)}</div><ul class="mt-1 text-[color:var(--fg-muted)]">${item.details.map((detail) => `<li>${esc(detail)}</li>`).join("")}</ul></li>`,
          )
          .join("")}</ul>`
      : `<p class="text-sm text-[color:var(--fg-muted)]">None.</p>`;
    return `<section class="mb-8"><h2 class="text-lg font-semibold mb-2">${title}</h2>${body}</section>`;
  };
  return `<h1 class="text-3xl font-semibold mb-3">Schema diff</h1><p class="text-[color:var(--fg-muted)] mb-6">Compared against ${esc(diff.againstLabel)}.</p><p class="mb-6 text-sm"><span class="text-emerald-700">+ ${diff.added.length}</span> · <span>~ ${diff.modified.length}</span> · <span class="text-red-700">- ${diff.removed.length}</span> · breaking ${breaking.length}</p>${compatibility}${section("Added", diff.added, "text-emerald-800")}${section("Modified", diff.modified, "")}${section("Removed", diff.removed, "text-red-800")}`;
}

export function homeWarningsHtml(warnings: string[] | undefined): string {
  if (!warnings?.length) return "";
  return `<section class="mt-10"><h2 class="text-xl font-semibold mb-3">Build warnings</h2><ul class="text-sm text-amber-800 dark:text-amber-200 space-y-1">${warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></section>`;
}
