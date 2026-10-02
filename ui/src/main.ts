import "../../site/src/styles/global.css";
import { fieldTableEntries, type FieldTableEntry } from "../../src/core/field-table.ts";
import {
  activePackageName,
  buildPackageNavTree,
  homePackageAreas,
  type PackageNavNode,
} from "../../src/core/package-nav.ts";
import { buildSourceTree, type SourceTreeNode } from "../../src/core/source-tree.ts";
import { rankSymbol } from "../../src/core/search.ts";
import type {
  DocEnum,
  DocExtension,
  DocField,
  DocFile,
  DocMessage,
  DocMethod,
  DocOneof,
  DocOption,
  DocPackage,
  DocService,
  DocSymbol,
  SchemaModel,
  SymbolIndexEntry,
  TypeRef,
} from "../../src/core/types.ts";
import { THEME_CHOICES, THEME_STORAGE_KEY, themeChoice, themeStorageValue, useDarkTheme } from "../../site/src/lib/theme.ts";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("missing #app");

const base = readBase();
const fullText = document.documentElement.dataset.fullText !== "false";
const siteUrl = document.documentElement.dataset.siteUrl || "";

const response = await fetch(join(base, "model.json"));
if (!response.ok) {
  app.textContent = "This documentation site is missing model.json.";
  throw new Error("model.json");
}
const model = (await response.json()) as SchemaModel;

installShell();
navigate();
window.addEventListener("popstate", navigate);
document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest("a");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("http") || href.startsWith("mailto:")) return;
  if (link.getAttribute("target") === "_blank") return;
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  if (!url.pathname.startsWith(base === "/" ? "/" : base)) return;
  event.preventDefault();
  history.pushState(null, "", url.pathname + url.hash);
  navigate();
});

function navigate() {
  const path = routePath();
  const main = document.querySelector("#main");
  if (!main) return;
  main.innerHTML = renderRoute(path);
  const hash = window.location.hash.slice(1);
  if (hash) document.getElementById(hash)?.scrollIntoView();
  document.title = pageTitle(path);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (siteUrl && canonical) canonical.setAttribute("href", new URL(window.location.pathname, siteUrl).href);
  highlightNav();
}

function renderRoute(path: string): string {
  if (path === "/") return renderHome();
  if (path === "/search/") return renderSearchPage();
  if (path === "/explore/") return renderExplore();
  if (path === "/graph/") return renderGraph();
  if (path === "/diff/") return renderDiff();
  if (path === "/source/") return renderSourceIndex();
  const file = model.files.find((item) => item.generatePage && item.urlPath === path);
  if (file) return renderFile(file);
  const pkg = model.packages.find((item) => item.urlPath === path);
  if (pkg && pkg.generatePage) return renderPackage(pkg);
  const message = model.messages.find((item) => item.urlPath === path);
  if (message && message.generatePage) return renderMessage(message);
  const enumDoc = model.enums.find((item) => item.urlPath === path);
  if (enumDoc && enumDoc.generatePage) return renderEnum(enumDoc);
  const service = model.services.find((item) => item.urlPath === path);
  if (service && service.generatePage) return renderService(service);
  const method = model.methods.find((item) => item.urlPath === path);
  if (method && method.generatePage) return renderMethod(method);
  const extension = model.extensions.find((item) => item.urlPath === path);
  if (extension && extension.generatePage) return renderExtension(extension);
  return `<h1 class="text-3xl font-semibold">Page not found</h1><p class="mt-3 text-[color:var(--fg-muted)]">No documented symbol lives at this path.</p>`;
}

function renderHome(): string {
  const local = model.packages.filter((item) => item.domain === "local" && item.inNav);
  const areas = homePackageAreas(
    local.map((pkg) => ({
      fullName: pkg.fullName,
      urlPath: pkg.urlPath,
      services: pkg.serviceIds.length,
      messages: pkg.messageIds.length,
    })),
  );
  const stats = [
    ["Packages", local.length],
    ["Symbols", model.buildInfo.symbolCount],
    ["Files", model.buildInfo.fileCount],
    ["Services", model.services.filter((item) => item.domain === "local").length],
    ["Custom options", model.extensions.filter((item) => item.optionTarget).length],
  ];
  const areaHtml = areas.length
    ? `<ul class="space-y-2">${areas
        .map((area) => {
          const name = area.urlPath ? `<a class="home-area-name" href="${href(area.urlPath)}">${esc(area.label)}</a>` : `<span class="home-area-name">${esc(area.label)}</span>`;
          const children = area.nodes
            .map((node) => nodeHtml(node))
            .join("");
          return `<li><details class="home-area" open><summary><span class="home-area-label">${name}<span class="text-[color:var(--fg-muted)] text-sm">${esc(areaCounts(area.counts))}</span></span></summary><div class="home-area-body">${children}</div></details></li>`;
        })
        .join("")}</ul>`
    : `<p class="text-[color:var(--fg-muted)]">No project packages matched the documentation include rules.</p>`;
  return `
    <p class="text-xs uppercase tracking-[0.18em] text-[color:var(--accent)] font-semibold">Static schema explorer</p>
    <h1 class="text-4xl font-semibold mt-2 mb-4">${esc(model.title)}</h1>
    <p class="text-lg text-[color:var(--fg-muted)] max-w-2xl">Browse services, messages, enums, and custom options as a fully static site. No schema registry or documentation server is required.</p>
    <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 my-8">
      ${stats.map(([label, value]) => `<div class="rounded-xl border border-[color:var(--line)] bg-[color:var(--bg-raised)] p-4"><dt class="text-xs text-[color:var(--fg-muted)]">${label}</dt><dd class="text-2xl font-semibold">${value}</dd></div>`).join("")}
    </dl>
    <section class="mb-10"><h2 class="text-xl font-semibold mb-3">Packages</h2>${areaHtml}</section>
    ${model.diff ? `<p><a href="${href("/diff/")}">Schema diff</a> against ${esc(model.diff.againstLabel)}.</p>` : ""}
  `;
}

function nodeHtml(node: PackageNavNode): string {
  const label = node.item ? `<a href="${href(node.item.urlPath)}">${esc(node.segment)}</a>` : esc(node.segment);
  const children = node.children.length ? `<ul class="space-y-1 ml-3">${node.children.map(nodeHtml).join("")}</ul>` : "";
  return `<div class="py-0.5">${label}${children}</div>`;
}

function areaCounts(counts: { packages: number; services: number; messages: number }): string {
  return `${counts.packages} packages · ${counts.services} services · ${counts.messages} messages`;
}

function renderPackage(pkg: DocPackage): string {
  return `
    ${crumb(pkg.fullName)}
    <h1 class="text-3xl font-semibold mt-2">${esc(pkg.fullName)}</h1>
    ${comment(pkg)}
    ${symbolList("Services", ids(pkg.serviceIds))}
    ${symbolList("Messages", ids(pkg.messageIds).filter((item) => !item.fullName.slice(pkg.fullName.length + 1).includes(".")))}
    ${symbolList("Enums", ids(pkg.enumIds))}
    ${symbolList("Extensions", ids(pkg.extensionIds))}
    ${symbolList("Files", ids(pkg.fileIds))}
  `;
}

function renderMessage(message: DocMessage): string {
  const fields = message.fieldIds.map((id) => model.symbols[id] as DocField);
  const oneofs = message.oneofIds.map((id) => model.symbols[id] as DocOneof);
  const note = model.wktNotes?.[message.fullName] ?? "";
  return `
    ${header(message)}
    ${note ? `<div class="prose-doc mt-4">${note}</div>` : ""}
    ${comment(message)}
    ${optionsBlock(message.options)}
    <h2 class="text-xl font-semibold mt-8 mb-3">Fields</h2>
    ${fieldTable(fields, oneofs)}
    ${symbolList("Nested messages", ids(message.nestedMessageIds))}
    ${symbolList("Nested enums", ids(message.nestedEnumIds))}
    ${symbolList("Extensions", ids(message.nestedExtensionIds))}
    ${reserved(message.reservedNames, message.reservedRanges)}
    ${examples(message)}
    ${usedBy(message)}
  `;
}

function renderEnum(doc: DocEnum): string {
  const rows = doc.valueIds
    .map((id) => model.symbols[id] as DocSymbol & { number: number })
    .map(
      (value) => `<tr id="${esc(value.anchor ?? "")}"><td class="font-mono">${esc(value.shortName)}</td><td>${value.number}</td><td>${commentCell(value)}</td></tr>`,
    )
    .join("");
  return `
    ${header(doc)}
    ${comment(doc)}
    <p class="text-sm text-[color:var(--fg-muted)] mt-2">${doc.open ? "Open" : "Closed"} enum${doc.allowAlias ? " · aliases allowed" : ""}</p>
    <div class="table-wrap mt-6"><table><thead><tr><th>Name</th><th>Number</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${usedBy(doc)}
  `;
}

function renderService(service: DocService): string {
  const rows = service.methodIds
    .map((id) => model.symbols[id] as DocMethod)
    .map((method) => {
      const http = method.options.find((option) => option.semantic?.rendererId === "google.api.http");
      return `<tr><td><a href="${href(method.urlPath)}">${esc(method.shortName)}</a></td><td class="font-mono text-xs">${typeLink(method.input)} → ${typeLink(method.output)}</td><td>${esc(http?.semantic?.summary ?? method.streamingKind)}</td><td>${commentCell(method)}</td></tr>`;
    })
    .join("");
  return `
    ${header(service)}
    ${comment(service)}
    <div class="table-wrap mt-6"><table><thead><tr><th>Method</th><th>Types</th><th>Mapping</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${usedBy(service)}
  `;
}

function renderMethod(method: DocMethod): string {
  const service = model.symbols[method.parentId] as DocService | undefined;
  const http = method.options.filter((option) => option.semantic?.rendererId === "google.api.http");
  return `
    ${header(method)}
    ${service ? `<p class="mt-2 text-sm">Service <a href="${href(service.urlPath)}">${esc(service.fullName)}</a></p>` : ""}
    <pre class="mt-4 overflow-x-auto rounded-lg bg-[color:var(--bg-muted)] p-4 text-sm"><code>${esc(method.signature)}</code></pre>
    ${comment(method)}
    <dl class="grid sm:grid-cols-2 gap-3 my-6">
      <div class="rounded-xl border border-[color:var(--line)] p-4"><dt class="text-xs text-[color:var(--fg-muted)]">Request</dt><dd class="mt-1">${typeLink(method.input)}</dd></div>
      <div class="rounded-xl border border-[color:var(--line)] p-4"><dt class="text-xs text-[color:var(--fg-muted)]">Response</dt><dd class="mt-1">${typeLink(method.output)}</dd></div>
    </dl>
    ${http.map((option) => `<p class="mb-2"><span class="rounded bg-[color:var(--bg-muted)] px-2 py-1 font-mono text-sm">${esc(option.semantic?.summary ?? "")}</span></p>`).join("")}
    ${optionsBlock(method.options)}
    ${messageFields("Request fields", method.input)}
    ${messageFields("Response fields", method.output)}
    ${usedBy(method)}
  `;
}

function renderExtension(ext: DocExtension): string {
  return `
    ${header(ext)}
    ${comment(ext)}
    <pre class="mt-4 overflow-x-auto rounded-lg bg-[color:var(--bg-muted)] p-4 text-sm"><code>${esc(ext.declaration)}</code></pre>
    <p class="mt-4">Extends ${typeLink(ext.extendee)} · type ${typeLink(ext.type)} · number ${ext.number}</p>
    ${ext.optionTarget ? `<p class="mt-2 text-sm text-[color:var(--fg-muted)]">Custom option on ${esc(ext.optionTarget)} declarations.</p>` : ""}
    ${usedBy(ext)}
  `;
}

function renderFile(file: DocFile): string {
  const lines = (file.sourceText ?? "").split("\n");
  const body = lines
    .map((line, index) => `<tr id="L${index + 1}"><td class="pr-4 text-right text-[color:var(--fg-muted)] select-none">${index + 1}</td><td><code>${esc(line) || " "}</code></td></tr>`)
    .join("");
  return `
    <h1 class="text-2xl font-semibold font-mono">${esc(file.fullName)}</h1>
    <p class="mt-2 text-sm text-[color:var(--fg-muted)]">${esc(file.syntax)}${file.edition ? ` · edition ${esc(file.edition)}` : ""}</p>
    ${file.repositoryLink ? `<p class="mt-3"><a href="${esc(file.repositoryLink.url)}">View on GitHub</a></p>` : ""}
    <div class="table-wrap mt-6"><table class="font-mono text-sm">${body}</table></div>
  `;
}

function renderSourceIndex(): string {
  const files = model.files.filter((file) => file.generatePage && file.sourceText);
  const tree = buildSourceTree(files.map((file) => ({ fullName: file.fullName, urlPath: file.urlPath })));
  return `<h1 class="text-3xl font-semibold mb-4">Source</h1>${sourceNodes(tree)}`;
}

function sourceNodes(nodes: SourceTreeNode[]): string {
  return `<ul class="space-y-1">${nodes
    .map((node) => {
      const label = node.file ? `<a href="${href(node.file.urlPath)}">${esc(node.segment)}</a>` : esc(node.segment);
      return `<li>${label}${node.children.length ? sourceNodes(node.children) : ""}</li>`;
    })
    .join("")}</ul>`;
}

function renderSearchPage(): string {
  return `<h1 class="text-3xl font-semibold">Search</h1><p class="mt-3 text-[color:var(--fg-muted)]">Use the search box in the header. It matches symbol names${fullText ? " and comment text" : ""}.</p>`;
}

function renderExplore(): string {
  const rows = Object.values(model.symbols)
    .filter((symbol) => symbol.referencedBy.length > 0 && symbol.generatePage)
    .slice(0, 200)
    .map((symbol) => `<li><a href="${href(symbol.urlPath)}">${esc(symbol.fullName)}</a> <span class="text-[color:var(--fg-muted)]">${symbol.referencedBy.length}</span></li>`)
    .join("");
  return `<h1 class="text-3xl font-semibold mb-4">Used by</h1><ul class="space-y-1">${rows || "<li>No incoming references.</li>"}</ul>`;
}

function renderGraph(): string {
  const rows = model.packages
    .filter((pkg) => pkg.generatePage)
    .map((pkg) => `<li><a href="${href(pkg.urlPath)}">${esc(pkg.fullName)}</a> <span class="text-[color:var(--fg-muted)]">${pkg.serviceIds.length} services · ${pkg.messageIds.length} messages</span></li>`)
    .join("");
  return `<h1 class="text-3xl font-semibold mb-4">Packages</h1><ul class="space-y-1">${rows}</ul>`;
}

function renderDiff(): string {
  const diff = model.diff;
  if (!diff) return `<h1 class="text-3xl font-semibold">No schema diff</h1><p class="mt-3">Build again with <code>--against</code> to compare two descriptor sets.</p>`;
  const list = (title: string, items: { fullName: string; kind: string; details: string[] }[]) =>
    `<h2 class="text-xl font-semibold mt-6 mb-2">${title} (${items.length})</h2><ul class="space-y-2">${items
      .map((item) => `<li><span class="font-mono">${esc(item.kind)}</span> ${esc(item.fullName)}<div class="text-sm text-[color:var(--fg-muted)]">${item.details.map(esc).join("<br>")}</div></li>`)
      .join("")}</ul>`;
  return `<h1 class="text-3xl font-semibold">Schema diff</h1><p class="mt-2 text-[color:var(--fg-muted)]">Against ${esc(diff.againstLabel)}</p>${list("Added", diff.added)}${list("Removed", diff.removed)}${list("Modified", diff.modified)}`;
}

function fieldTable(fields: DocField[], oneofs: DocOneof[]): string {
  const entries = fieldTableEntries(fields, oneofs);
  const rows = entries.map((entry) => fieldRow(entry)).join("");
  return `<div class="table-wrap"><table class="fields schema-fields"><thead><tr><th>Field</th><th>Number</th><th>Type</th><th>Cardinality</th><th>Validation</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function fieldRow(entry: FieldTableEntry): string {
  if (entry.kind === "oneof") {
    const chips = validationChips(entry.oneof.options);
    const head = `<tr id="${esc(entry.oneof.anchor ?? "")}" class="oneof"><td class="font-mono">${esc(entry.oneof.shortName)}<div class="text-[11px] text-[color:var(--fg-muted)]">oneof</div></td><td>—</td><td>oneof</td><td>${chips.includes("required") ? "required" : "optional"}</td><td>${chipsHtml(chips)}</td><td>${commentCell(entry.oneof)}</td></tr>`;
    return head + entry.members.map((field) => fieldCells(field, true)).join("");
  }
  return fieldCells(entry.field, false);
}

function fieldCells(field: DocField, nested: boolean): string {
  const type = field.cardinality === "map" ? `map&lt;${esc(field.mapKey?.name ?? "string")}, ${linkName(field.mapValue)}&gt;` : typeLink(field.type);
  const badges = field.options.flatMap((option) =>
    option.semantic && !isValidation(option.semantic.rendererId) ? option.semantic.badges ?? [] : [],
  );
  return `<tr id="${esc(field.anchor ?? "")}"><td class="${nested ? "pl-6" : ""} font-mono">${esc(field.shortName)}${field.deprecated ? ` <span class="text-xs">deprecated</span>` : ""}${badges.length ? `<div>${chipsHtml(badges)}</div>` : ""}</td><td>${field.number}</td><td class="font-mono text-xs">${type}</td><td>${esc(field.cardinality)}</td><td>${chipsHtml(validationChips(field.options))}</td><td>${commentCell(field)}</td></tr>`;
}

function messageFields(title: string, ref: TypeRef): string {
  const message = model.messages.find((item) => item.id === ref.id);
  if (!message) return "";
  const fields = message.fieldIds.map((id) => model.symbols[id] as DocField);
  const oneofs = message.oneofIds.map((id) => model.symbols[id] as DocOneof);
  return `<h2 class="text-xl font-semibold mt-8 mb-3">${esc(title)}</h2>${fieldTable(fields, oneofs)}`;
}

function header(symbol: DocSymbol): string {
  const source = symbol.sourceLink ? `<a href="${href(symbol.sourceLink.url)}">View source</a>` : "";
  const repo = symbol.repositoryLink ? `<a href="${esc(symbol.repositoryLink.url)}">View on GitHub</a>` : "";
  return `${crumb(symbol.fullName)}<p class="text-xs uppercase tracking-wider text-[color:var(--accent)] mt-2">${esc(symbol.kind)}</p><h1 class="text-3xl font-semibold mt-1">${esc(symbol.shortName)}</h1><p class="font-mono text-sm text-[color:var(--fg-muted)] mt-1">${esc(symbol.fullName)}</p><p class="mt-3 flex gap-4 text-sm">${source}${repo}</p>`;
}

function comment(symbol: DocSymbol): string {
  const html = symbol.comments?.markdownHtml;
  if (!html) return "";
  return `<div class="prose-doc mt-4">${html}</div>`;
}

function commentCell(symbol: DocSymbol): string {
  return symbol.comments?.markdownHtml ?? "";
}

function optionsBlock(options: DocOption[]): string {
  if (!options.length) return "";
  const rows = options
    .map((option) => {
      const title = option.semantic?.title ?? option.fullName;
      const summary = option.semantic?.summary ?? option.textProto;
      const def = option.definitionId ? model.symbols[option.definitionId] : undefined;
      const link = def?.generatePage ? ` <a href="${href(def.urlPath)}">definition</a>` : "";
      return `<li><span class="font-medium">${esc(title)}</span> ${esc(summary)}${link}</li>`;
    })
    .join("");
  return `<h2 class="text-xl font-semibold mt-8 mb-3">Options</h2><ul class="space-y-1">${rows}</ul>`;
}

function examples(message: DocMessage): string {
  if (message.exampleJson == null && !message.exampleTextProto) return "";
  const json = message.exampleJson != null ? JSON.stringify(message.exampleJson, null, 2) : "";
  return `<h2 class="text-xl font-semibold mt-8 mb-3">Example</h2>${json ? `<pre class="overflow-x-auto rounded-lg bg-[color:var(--bg-muted)] p-4 text-sm"><code>${esc(json)}</code></pre>` : ""}${message.exampleTextProto ? `<pre class="mt-3 overflow-x-auto rounded-lg bg-[color:var(--bg-muted)] p-4 text-sm"><code>${esc(message.exampleTextProto)}</code></pre>` : ""}`;
}

function usedBy(symbol: DocSymbol): string {
  if (!symbol.referencedBy.length) return "";
  const items = symbol.referencedBy
    .slice(0, 100)
    .map((ref) => {
      const from = model.symbols[ref.fromId];
      const label = from ? esc(from.fullName) : esc(ref.fromId);
      const link = from?.urlPath ? `<a href="${href(anchorHref(from))}">${label}</a>` : label;
      return `<li>${link} <span class="text-[color:var(--fg-muted)]">${esc(ref.kind)}</span></li>`;
    })
    .join("");
  return `<h2 class="text-xl font-semibold mt-8 mb-3">Used by</h2><ul class="space-y-1">${items}</ul>`;
}

function symbolList(title: string, symbols: DocSymbol[]): string {
  const visible = symbols.filter((item) => item.generatePage || item.kind === "file");
  if (!visible.length) return "";
  return `<h2 class="text-xl font-semibold mt-8 mb-3">${esc(title)}</h2><ul class="space-y-1">${visible
    .map((item) => `<li><a href="${href(item.urlPath)}">${esc(item.shortName)}</a> <span class="text-[color:var(--fg-muted)] font-mono text-xs">${esc(item.fullName)}</span></li>`)
    .join("")}</ul>`;
}

function reserved(names: string[], ranges: { start: number; end: number }[]): string {
  if (!names.length && !ranges.length) return "";
  return `<p class="mt-4 text-sm text-[color:var(--fg-muted)]">Reserved ${esc([...names, ...ranges.map((range) => `${range.start} to ${range.end}`)].join(", "))}</p>`;
}

function typeLink(ref: TypeRef | undefined): string {
  if (!ref) return "";
  if (ref.externalUrl) return `<a href="${esc(ref.externalUrl)}">${esc(ref.name)}</a>`;
  if (ref.urlPath) return `<a href="${href(ref.urlPath)}">${esc(ref.name)}</a>`;
  return esc(ref.name);
}

function linkName(ref: TypeRef | undefined): string {
  return ref ? typeLink(ref) : "string";
}

function validationChips(options: DocOption[]): string[] {
  const chips: string[] = [];
  for (const option of options) {
    const semantic = option.semantic;
    if (!isValidation(semantic?.rendererId)) continue;
    chips.push(...(semantic?.badges ?? (semantic?.summary ? [semantic.summary] : [])));
  }
  return chips;
}

function isValidation(id: string | undefined): boolean {
  return id === "validation" || id === "cybozu.validate";
}

function chipsHtml(chips: string[]): string {
  return chips.map((chip) => `<span class="inline-block rounded bg-[color:var(--bg-muted)] px-1.5 py-0.5 text-xs mr-1">${esc(chip)}</span>`).join("");
}

function ids(list: string[]): DocSymbol[] {
  return list.map((id) => model.symbols[id]).filter((item): item is DocSymbol => Boolean(item));
}

function crumb(fullName: string): string {
  return `<p class="text-sm text-[color:var(--fg-muted)]"><a href="${href("/")}">Home</a> / ${esc(fullName)}</p>`;
}

function pageTitle(path: string): string {
  if (path === "/") return model.title;
  const symbol = Object.values(model.symbols).find((item) => item.urlPath === path && item.generatePage);
  return symbol ? `${symbol.shortName} · ${model.title}` : model.title;
}

function installShell() {
  const local = model.packages.filter((item) => item.inNav && item.domain === "local");
  const wkt = model.packages.filter((item) => item.domain === "well-known" && item.generatePage);
  const tree = buildPackageNavTree(local.map((pkg) => ({ fullName: pkg.fullName, urlPath: pkg.urlPath })));
  const source = model.files.some((file) => file.sourceText && file.generatePage);
  app!.innerHTML = `
    <div class="lg:grid lg:grid-cols-[18rem_1fr] min-h-screen">
      <aside id="sidebar" class="hidden lg:flex flex-col border-r border-[color:var(--line)] bg-[color:var(--bg-raised)] px-4 py-5 gap-6">
        <a href="${href("/")}" class="no-underline text-[color:var(--fg)]"><div class="text-[11px] tracking-[0.12em] text-[color:var(--accent)] font-semibold">pbschema-lens</div><div class="text-lg font-semibold leading-tight mt-1">${esc(model.title)}</div></a>
        <nav id="side-nav" class="text-sm space-y-4 overflow-y-auto">
          <div><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">API Reference</div>${navTree(tree)}</div>
          ${wkt.length ? `<div><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">Protobuf standard library</div><ul class="space-y-1">${wkt.map((pkg) => `<li><a class="block rounded-md px-2 py-1 no-underline text-[color:var(--fg)]" href="${href(pkg.urlPath)}">${esc(pkg.fullName)}</a></li>`).join("")}</ul></div>` : ""}
          <div><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">Explore</div>
            <ul class="space-y-1">
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/explore/")}">Used-by explorer</a></li>
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/graph/")}">Package graph</a></li>
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/search/")}">Search</a></li>
              ${source ? `<li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/source/")}">Source</a></li>` : ""}
              ${model.diff ? `<li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/diff/")}">Schema diff</a></li>` : ""}
            </ul>
          </div>
        </nav>
      </aside>
      <div class="min-w-0">
        <header class="sticky top-0 z-20 border-b border-[color:var(--line)] bg-[color:var(--bg)]/90 backdrop-blur">
          <div class="flex items-center gap-3 px-4 py-3">
            <button id="menu-btn" class="lg:hidden rounded-md border border-[color:var(--line)] px-2 py-1 text-sm" type="button">Menu</button>
            <button id="search-open" class="flex-1 text-left rounded-md border border-[color:var(--line)] bg-[color:var(--bg-raised)] px-3 py-2 text-sm text-[color:var(--fg-muted)]" type="button">Search symbols and comments… <kbd class="hidden sm:inline float-right text-[11px] border border-[color:var(--line)] rounded px-1">/</kbd></button>
            <div class="relative">
              <button id="theme-menu-button" class="rounded-md border border-[color:var(--line)] px-2 py-1 text-sm" type="button" aria-haspopup="menu" aria-expanded="false">Theme</button>
              <div id="theme-menu" class="absolute right-0 z-30 mt-1 min-w-44 rounded-md border border-[color:var(--line)] bg-[color:var(--bg-raised)] py-1 text-sm shadow-[var(--shadow)]" role="menu" hidden>
                ${THEME_CHOICES.map((choice) => `<button class="block w-full px-3 py-1.5 text-left hover:bg-[color:var(--bg-muted)]" type="button" data-theme-choice="${choice.value}">${choice.label}</button>`).join("")}
              </div>
            </div>
          </div>
        </header>
        <main id="main" class="w-full min-w-0 px-4 py-8 sm:px-8"></main>
      </div>
    </div>
    <div id="mobile-nav" class="hidden fixed inset-0 z-30 bg-black/50 lg:hidden"><div id="mobile-panel" class="h-full w-72 bg-[color:var(--bg-raised)] p-4 overflow-y-auto"></div></div>
    <dialog id="search-dialog" class="w-[min(720px,92vw)] rounded-xl border border-[color:var(--line)] bg-[color:var(--bg-raised)] p-0 text-[color:var(--fg)]">
      <div class="p-3 border-b border-[color:var(--line)]"><input id="search-input" class="w-full bg-transparent outline-none text-base" placeholder="Search symbols, comments, options…" /></div>
      <div id="search-results" class="max-h-[60vh] overflow-y-auto p-2 text-sm"></div>
    </dialog>
    ${siteUrl ? `<link rel="canonical" href="${esc(siteUrl)}" />` : ""}
  `;
  document.getElementById("menu-btn")?.addEventListener("click", () => {
    const panel = document.getElementById("mobile-panel");
    const nav = document.getElementById("side-nav");
    if (panel && nav) panel.innerHTML = nav.innerHTML;
    document.getElementById("mobile-nav")?.classList.remove("hidden");
  });
  document.getElementById("mobile-nav")?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).id === "mobile-nav") document.getElementById("mobile-nav")?.classList.add("hidden");
  });
  const themeButton = document.getElementById("theme-menu-button");
  const themeMenu = document.getElementById("theme-menu");
  themeButton?.addEventListener("click", () => {
    if (!themeMenu) return;
    themeMenu.hidden = !themeMenu.hidden;
  });
  themeMenu?.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest("[data-theme-choice]")?.getAttribute("data-theme-choice");
    if (!choice) return;
    const stored = themeStorageValue(choice);
    if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
    else localStorage.removeItem(THEME_STORAGE_KEY);
    applyTheme();
    if (themeMenu) themeMenu.hidden = true;
  });
  applyTheme();
  const dialog = document.querySelector<HTMLDialogElement>("#search-dialog");
  const input = document.querySelector<HTMLInputElement>("#search-input");
  document.getElementById("search-open")?.addEventListener("click", () => {
    dialog?.showModal();
    input?.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      dialog?.showModal();
      input?.focus();
    }
  });
  input?.addEventListener("input", () => renderHits(input.value));
}

function applyTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const dark = useDarkTheme(stored, window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  const current = themeChoice(stored);
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((item) => {
    item.setAttribute("aria-checked", item.dataset.themeChoice === current ? "true" : "false");
  });
}

function renderHits(query: string) {
  const box = document.getElementById("search-results");
  if (!box) return;
  const q = query.trim();
  if (!q) {
    box.innerHTML = "";
    return;
  }
  const hits: { entry: SymbolIndexEntry; score: number }[] = [];
  for (const entry of model.symbolIndex) {
    const score = rankSymbol(entry, q);
    if (score) hits.push({ entry, score });
  }
  if (fullText) {
    const lower = q.toLowerCase();
    for (const symbol of Object.values(model.symbols)) {
      const text = `${symbol.comments?.leading ?? ""} ${symbol.comments?.trailing ?? ""}`.toLowerCase();
      if (!text.includes(lower)) continue;
      if (hits.some((hit) => hit.entry.id === symbol.id)) continue;
      hits.push({
        entry: { id: symbol.id, name: symbol.shortName, fullName: symbol.fullName, kind: symbol.kind, package: symbol.packageName, urlPath: anchorHref(symbol) },
        score: 15,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.entry.fullName.localeCompare(b.entry.fullName));
  box.innerHTML = hits
    .slice(0, 50)
    .map(
      (hit) =>
        `<a class="block rounded-md px-2 py-2 no-underline hover:bg-[color:var(--bg-muted)]" href="${href(hit.entry.urlPath)}"><div class="text-xs text-[color:var(--fg-muted)]">${esc(hit.entry.kind)}</div><div>${esc(hit.entry.fullName)}</div></a>`,
    )
    .join("") || `<p class="p-3 text-[color:var(--fg-muted)]">No matches.</p>`;
}

function highlightNav() {
  const local = model.packages.filter((item) => item.inNav && item.domain === "local").map((pkg) => ({ fullName: pkg.fullName }));
  const active = activePackageName(routePath(), local);
  document.querySelectorAll("#side-nav a").forEach((link) => {
    const on = active != null && link.getAttribute("href") === href(`/reference/packages/${encodeURIComponent(active)}/`);
    link.classList.toggle("bg-[color:var(--bg-muted)]", on);
  });
}

function navTree(nodes: PackageNavNode[]): string {
  return `<ul class="space-y-1">${nodes
    .map((node) => {
      const label = node.item ? `<a class="block rounded-md px-2 py-1 no-underline text-[color:var(--fg)]" href="${href(node.item.urlPath)}">${esc(node.segment)}</a>` : `<div class="px-2 py-1 text-[color:var(--fg-muted)]">${esc(node.segment)}</div>`;
      return `<li>${label}${node.children.length ? navTree(node.children) : ""}</li>`;
    })
    .join("")}</ul>`;
}

function anchorHref(symbol: DocSymbol): string {
  return symbol.anchor ? `${symbol.urlPath}#${symbol.anchor}` : symbol.urlPath;
}

function routePath(): string {
  let path = window.location.pathname;
  if (base !== "/" && path.startsWith(base)) path = path.slice(base.length - 1);
  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.endsWith("/")) path += "/";
  return path;
}

function readBase(): string {
  const raw = document.documentElement.dataset.base || "/";
  if (!raw || raw === "/") return "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function href(urlPath: string): string {
  const [path, hash] = urlPath.split("#");
  const prefix = base === "/" ? "" : base.slice(0, -1);
  const joined = `${prefix}${path?.startsWith("/") ? path : `/${path ?? ""}`}`;
  return hash ? `${joined}#${hash}` : joined;
}

function join(prefix: string, name: string): string {
  if (prefix === "/") return `/${name}`;
  return `${prefix}${name}`;
}

function esc(value: string | undefined): string {
  return (value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
