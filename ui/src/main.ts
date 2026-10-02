import "../../site/src/styles/global.css";
import { fieldTableEntries, type FieldTableEntry } from "../../src/core/field-table.ts";
import { activePackageName, buildPackageNavTree, homePackageAreas } from "../../src/core/package-nav.ts";
import { homeAreasHtml, packageTreeHtml, sourceFilePageHtml, sourceIndexHtml } from "../../site/src/lib/trees.ts";
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
  SymbolIndexEntry,
  SymbolReference,
  TypeRef,
} from "../../src/core/types.ts";
import { isExternalHref, repositoryLinkLabel } from "../../site/src/lib/repository-link.ts";
import { THEME_CHOICES, THEME_STORAGE_KEY, themeChoice, themeStorageValue, useDarkTheme } from "../../site/src/lib/theme.ts";
import { createLoader, type GraphEdge, type Loader, type SiteIndex } from "./load.ts";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("missing #app");

const base = readBase();
const fullText = document.documentElement.dataset.fullText !== "false";
const siteUrl = document.documentElement.dataset.siteUrl || "";
const loader: Loader = createLoader(base);

const index = await loadIndex();
const byId = new Map(index.symbolIndex.map((entry) => [entry.id, entry]));
let navToken = 0;

installShell();
void navigate();
window.addEventListener("popstate", () => {
  void navigate();
});
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
  void navigate();
});

async function loadIndex(): Promise<SiteIndex> {
  try {
    return await loader.index();
  } catch {
    app!.textContent = "This documentation site is missing its symbol index.";
    throw new Error("index");
  }
}

async function navigate() {
  const token = ++navToken;
  const path = routePath();
  const main = document.querySelector("#main");
  if (!main) return;
  const html = await renderRoute(path);
  if (token !== navToken) return;
  main.innerHTML = html;
  const hash = window.location.hash.slice(1);
  if (hash) document.getElementById(hash)?.scrollIntoView();
  document.title = pageTitle(path);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (siteUrl && canonical) canonical.setAttribute("href", new URL(window.location.pathname, siteUrl).href);
  refreshPackageTree();
}

async function renderRoute(path: string): Promise<string> {
  if (path === "/") return renderHome();
  if (path === "/search/") return renderSearchPage();
  if (path === "/explore/") return renderExplore();
  if (path === "/graph/") return renderGraph();
  if (path === "/diff/") return renderDiff();
  if (path === "/source/") return renderSourceIndex();
  const entry = index.symbolIndex.find((item) => item.urlPath === path);
  if (!entry) return notFound();
  try {
    if (entry.kind === "file") return renderFile(await loader.source(entry.fullName));
    const page = await loader.symbol(entry.id);
    const symbol = page.symbol;
    const related = page.related;
    switch (entry.kind) {
      case "package":
        return renderPackage(symbol as DocPackage);
      case "message":
        return renderMessage(symbol as DocMessage, related);
      case "enum":
        return renderEnum(symbol as DocEnum, related);
      case "service":
        return renderService(symbol as DocService, related);
      case "method":
        return renderMethod(symbol as DocMethod, related);
      case "extension":
        return renderExtension(symbol as DocExtension);
      default:
        return notFound();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The symbol payload could not be loaded.";
    return `<h1 class="text-3xl font-semibold">Could not load this page</h1><p class="mt-3 text-[color:var(--fg-muted)]">${esc(message)}</p>`;
  }
}

function notFound(): string {
  return `<h1 class="text-3xl font-semibold">Page not found</h1><p class="mt-3 text-[color:var(--fg-muted)]">No documented symbol lives at this path.</p>`;
}

function renderHome(): string {
  const local = index.packages.filter((item) => item.domain === "local" && item.inNav);
  const areas = homePackageAreas(
    local.map((pkg) => ({
      fullName: pkg.fullName,
      urlPath: pkg.urlPath,
      services: pkg.services,
      messages: pkg.messages,
    })),
  );
  const stats = [
    ["Packages", local.length],
    ["Symbols", index.buildInfo.symbolCount],
    ["Files", index.buildInfo.fileCount],
    ["Services", index.localServices],
    ["Custom options", index.customOptions],
  ];
  const wkt = index.packages.filter((item) => item.domain === "well-known" && item.generatePage);
  const wktHtml = wkt.length
    ? `<section><h2 class="text-xl font-semibold mb-3">Protobuf standard library</h2><ul class="flex flex-wrap gap-2">${wkt.map((pkg) => `<li><a class="rounded-full border border-[color:var(--line)] px-3 py-1 text-sm no-underline text-[color:var(--fg)]" href="${href(pkg.urlPath)}">${esc(pkg.fullName)}</a></li>`).join("")}</ul></section>`
    : "";
  return `
    <p class="text-xs uppercase tracking-[0.18em] text-[color:var(--accent)] font-semibold">Static schema explorer</p>
    <h1 class="text-4xl font-semibold mt-2 mb-4">${esc(index.title)}</h1>
    <p class="text-lg text-[color:var(--fg-muted)] max-w-2xl">Browse services, messages, enums, and custom options as a fully static site. No schema registry or documentation server is required.</p>
    <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 my-8">
      ${stats.map(([label, value]) => `<div class="rounded-xl border border-[color:var(--line)] bg-[color:var(--bg-raised)] p-4"><dt class="text-xs text-[color:var(--fg-muted)]">${label}</dt><dd class="text-2xl font-semibold">${value}</dd></div>`).join("")}
    </dl>
    <section class="mb-10"><h2 class="text-xl font-semibold mb-3">Packages</h2>${homeAreasHtml(areas, href)}</section>
    ${wktHtml}
    ${index.hasDiff ? `<p><a href="${href("/diff/")}">Schema diff</a></p>` : ""}
  `;
}

function renderPackage(pkg: DocPackage): string {
  return `
    ${crumb(pkg.fullName)}
    <h1 class="text-3xl font-semibold mt-2">${esc(pkg.fullName)}</h1>
    ${comment(pkg)}
    ${symbolList("Services", packageEntries(pkg, "service", false))}
    ${symbolList("Messages", packageEntries(pkg, "message", true))}
    ${symbolList("Enums", packageEntries(pkg, "enum", false))}
    ${symbolList("Extensions", packageEntries(pkg, "extension", false))}
    ${symbolList("Files", packageEntries(pkg, "file", false))}
  `;
}

function renderMessage(message: DocMessage, related: Record<string, DocSymbol>): string {
  const fields = idsOf<DocField>(message.fieldIds, related);
  const oneofs = idsOf<DocOneof>(message.oneofIds, related);
  const note = index.wktNotes[message.fullName] ?? "";
  return `
    ${header(message)}
    ${note ? `<div class="prose-doc mt-4">${note}</div>` : ""}
    ${comment(message)}
    ${featuresBlock(message)}
    ${optionsBlock(message.options)}
    <h2 class="text-xl font-semibold mt-8 mb-3">Fields</h2>
    ${fieldTable(fields, oneofs)}
    ${symbolList("Nested messages", entriesById(message.nestedMessageIds))}
    ${symbolList("Nested enums", entriesById(message.nestedEnumIds))}
    ${symbolList("Extensions", entriesById(message.nestedExtensionIds))}
    ${reserved(message.reservedNames, message.reservedRanges)}
    ${examples(message)}
    ${usedBy(message)}
  `;
}

function renderEnum(doc: DocEnum, related: Record<string, DocSymbol>): string {
  const rows = idsOf<DocSymbol & { number: number }>(doc.valueIds, related)
    .map(
      (value) => `<tr id="${esc(value.anchor ?? "")}"><td class="font-mono">${esc(value.shortName)}</td><td>${value.number}</td><td>${commentCell(value)}</td></tr>`,
    )
    .join("");
  return `
    ${header(doc)}
    ${comment(doc)}
    ${featuresBlock(doc)}
    ${optionsBlock(doc.options)}
    <p class="text-sm text-[color:var(--fg-muted)] mt-2">${doc.open ? "Open" : "Closed"} enum${doc.allowAlias ? " · aliases allowed" : ""}</p>
    <div class="table-wrap mt-6"><table><thead><tr><th>Name</th><th>Number</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${usedBy(doc)}
  `;
}

function renderService(service: DocService, related: Record<string, DocSymbol>): string {
  const rows = idsOf<DocMethod>(service.methodIds, related)
    .map((method) => {
      const http = method.options.find((option) => option.semantic?.rendererId === "google.api.http");
      return `<tr><td><a href="${href(method.urlPath)}">${esc(method.shortName)}</a></td><td class="font-mono text-xs">${typeLink(method.input)} → ${typeLink(method.output)}</td><td>${esc(http?.semantic?.summary ?? method.streamingKind)}</td><td>${commentCell(method)}</td></tr>`;
    })
    .join("");
  return `
    ${header(service)}
    ${comment(service)}
    ${optionsBlock(service.options)}
    <div class="table-wrap mt-6"><table><thead><tr><th>Method</th><th>Types</th><th>Mapping</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${usedBy(service)}
  `;
}

function renderMethod(method: DocMethod, related: Record<string, DocSymbol>): string {
  const service = byId.get(method.parentId);
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
    ${messageFields("Request fields", method.input, related)}
    ${messageFields("Response fields", method.output, related)}
    ${usedBy(method)}
  `;
}

function renderExtension(ext: DocExtension): string {
  return `
    ${header(ext)}
    ${comment(ext)}
    ${optionsBlock(ext.options)}
    <pre class="mt-4 overflow-x-auto rounded-lg bg-[color:var(--bg-muted)] p-4 text-sm"><code>${esc(ext.declaration)}</code></pre>
    <p class="mt-4">Extends ${typeLink(ext.extendee)} · type ${typeLink(ext.type)} · number ${ext.number}</p>
    ${ext.optionTarget ? `<p class="mt-2 text-sm text-[color:var(--fg-muted)]">Custom option on ${esc(ext.optionTarget)} declarations.</p>` : ""}
    ${usedBy(ext)}
  `;
}

function sourceFiles() {
  return index.files
    .filter((file) => file.generatePage && file.hasSource)
    .map((file) => ({ fullName: file.fullName, urlPath: file.urlPath }));
}

function renderFile(file: DocFile): string {
  return sourceFilePageHtml(file, sourceFiles(), href);
}

function renderSourceIndex(): string {
  return sourceIndexHtml(sourceFiles(), href);
}

function renderSearchPage(): string {
  return `<h1 class="text-3xl font-semibold">Search</h1><p class="mt-3 text-[color:var(--fg-muted)]">Use the search box in the header. It matches symbol names${fullText ? " and comment text" : ""}.</p>`;
}

async function renderExplore(): Promise<string> {
  const refs = await loader.references();
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref.toId, (counts.get(ref.toId) ?? 0) + 1);
  const rows = index.symbolIndex
    .filter((entry) => !entry.urlPath.includes("#") && (counts.get(entry.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.fullName.localeCompare(b.fullName));
  const item = (entry: SymbolIndexEntry) =>
    `<li><a href="${href(entry.urlPath)}">${esc(entry.fullName)}</a> <span class="text-[color:var(--fg-muted)]">${counts.get(entry.id)}</span></li>`;
  const head = rows.slice(0, 100).map(item).join("");
  const rest = rows.slice(100);
  const more = rest.length
    ? `<details class="mt-3"><summary>Show ${rest.length} more</summary><ul class="space-y-1 mt-2">${rest.map(item).join("")}</ul></details>`
    : "";
  return `<h1 class="text-3xl font-semibold mb-4">Used by</h1><ul class="space-y-1">${head || "<li>No incoming references.</li>"}</ul>${more}`;
}

async function renderGraph(): Promise<string> {
  const graph = await loader.graph();
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const linkFor = (id: string) => {
    const node = nodes.get(id);
    if (!node) return esc(id);
    if (node.generatePage && node.urlPath) return `<a href="${href(node.urlPath)}">${esc(node.fullName)}</a>`;
    return esc(node.fullName);
  };
  const list = (edges: GraphEdge[], end: "to" | "from") => {
    if (!edges.length) return `<p class="text-sm text-[color:var(--fg-muted)]">None</p>`;
    return `<ul class="space-y-1">${edges
      .map((edge) => {
        const id = end === "to" ? edge.to : edge.from;
        const pub = edge.public ? ` <span class="text-xs text-[color:var(--fg-muted)]">public</span>` : "";
        return `<li>${linkFor(id)}${pub}</li>`;
      })
      .join("")}</ul>`;
  };
  const blocks = graph.nodes
    .filter((node) => node.generatePage)
    .map((node) => {
      const imports = graph.edges.filter((edge) => edge.from === node.id);
      const imported = graph.edges.filter((edge) => edge.to === node.id);
      const title = node.urlPath ? `<a href="${href(node.urlPath)}">${esc(node.fullName)}</a>` : esc(node.fullName);
      return `<section class="mb-8"><h2 class="text-xl font-semibold">${title}</h2><h3 class="text-sm font-semibold mt-3 mb-1">Imports</h3>${list(imports, "to")}<h3 class="text-sm font-semibold mt-3 mb-1">Imported by</h3>${list(imported, "from")}</section>`;
    })
    .join("");
  return `<h1 class="text-3xl font-semibold mb-6">Package graph</h1>${blocks || `<p class="text-[color:var(--fg-muted)]">No packages.</p>`}`;
}

async function renderDiff(): Promise<string> {
  if (!index.hasDiff) return `<h1 class="text-3xl font-semibold">No schema diff</h1><p class="mt-3">Build again with <code>--against</code> to compare two descriptor sets.</p>`;
  const diff = await loader.diff();
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
  return `<tr id="${esc(field.anchor ?? "")}"><td class="${nested ? "pl-6" : ""} font-mono">${esc(field.shortName)}${field.deprecated ? ` <span class="text-xs">deprecated</span>` : ""}${badges.length ? `<div>${chipsHtml(badges)}</div>` : ""}</td><td>${field.number}</td><td class="font-mono text-xs">${type}</td><td>${esc(field.cardinality)}</td><td>${chipsHtml(validationChips(field.options))}</td><td>${commentCell(field)}${fieldDetails(field)}</td></tr>`;
}

function fieldDetails(field: DocField): string {
  const packed = field.packed == null ? "" : `<div><span class="text-[color:var(--fg-muted)]">Packed</span> ${field.packed ? "true" : "false"}</div>`;
  const fallback = field.defaultValue ? `<div><span class="text-[color:var(--fg-muted)]">Default</span> <span class="font-mono">${esc(field.defaultValue)}</span></div>` : "";
  const raw = field.options.map((option) => option.textProto).filter(Boolean);
  const options = raw.length ? `<div><span class="text-[color:var(--fg-muted)]">Options</span> <span class="font-mono">${raw.map((text) => esc(text)).join("; ")}</span></div>` : "";
  return `<details class="mt-1"><summary class="cursor-pointer text-xs">Details</summary><div class="text-xs space-y-1 mt-1"><div><span class="text-[color:var(--fg-muted)]">JSON name</span> <span class="font-mono">${esc(field.jsonName)}</span></div><div><span class="text-[color:var(--fg-muted)]">Presence</span> ${esc(field.presence)}</div>${packed}${fallback}${options}</div></details>`;
}

function messageFields(title: string, ref: TypeRef, related: Record<string, DocSymbol>): string {
  const message = ref.id ? (related[ref.id] as DocMessage | undefined) : undefined;
  if (!message || message.kind !== "message") return "";
  const fields = idsOf<DocField>(message.fieldIds, related);
  const oneofs = idsOf<DocOneof>(message.oneofIds, related);
  return `<h2 class="text-xl font-semibold mt-8 mb-3">${esc(title)}</h2>${fieldTable(fields, oneofs)}`;
}

function header(symbol: DocSymbol): string {
  const source = symbol.sourceLink ? `<a href="${esc(hrefFor(symbol.sourceLink.url))}">View source</a>` : "";
  const repo = symbol.repositoryLink ? `<a href="${esc(symbol.repositoryLink.url)}">${repositoryLinkLabel(symbol.repositoryLink.url)}</a>` : "";
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

function featuresBlock(symbol: DocSymbol): string {
  const features = symbol.features ?? [];
  if (!features.length) return "";
  const rows = features
    .map((feature) => {
      const from = feature.inheritedFrom ? ` (${esc(feature.inheritedFrom)})` : "";
      return `<tr><td class="font-mono text-xs">${esc(feature.name)}</td><td class="font-mono text-xs">${esc(feature.effective)}</td><td>${esc(feature.source)}${from}</td><td class="font-mono text-xs">${esc(feature.declared ?? "")}</td></tr>`;
    })
    .join("");
  return `<h2 class="text-xl font-semibold mt-8 mb-3">Features</h2><div class="table-wrap"><table><thead><tr><th>Feature</th><th>Effective</th><th>Source</th><th>Declared</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function optionsBlock(options: DocOption[] | undefined): string {
  const list = options ?? [];
  if (!list.length) return "";
  const rows = list
    .map((option) => {
      const title = option.semantic?.title ?? option.fullName;
      const summary = option.semantic?.summary ?? option.textProto;
      const def = option.definitionId ? byId.get(option.definitionId) : undefined;
      const link = def ? ` <a href="${href(def.urlPath)}">definition</a>` : "";
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
  const refs = symbol.referencedBy ?? [];
  if (!refs.length) return "";
  const item = (ref: SymbolReference) => {
    const from = byId.get(ref.fromId);
    const label = from ? esc(from.fullName) : esc(ref.fromId);
    const link = from?.urlPath ? `<a href="${href(from.urlPath)}">${label}</a>` : label;
    return `<li>${link} <span class="text-[color:var(--fg-muted)]">${esc(ref.kind)}</span></li>`;
  };
  const head = refs.slice(0, 100).map(item).join("");
  const rest = refs.slice(100);
  const more = rest.length
    ? `<details class="mt-2"><summary>Show ${rest.length} more</summary><ul class="space-y-1 mt-2">${rest.map(item).join("")}</ul></details>`
    : "";
  return `<h2 class="text-xl font-semibold mt-8 mb-3">Used by</h2><ul class="space-y-1">${head}</ul>${more}`;
}

function symbolList(title: string, entries: SymbolIndexEntry[]): string {
  if (!entries.length) return "";
  return `<h2 class="text-xl font-semibold mt-8 mb-3">${esc(title)}</h2><ul class="space-y-1">${entries
    .map((item) => `<li><a href="${href(item.urlPath)}">${esc(item.name)}</a> <span class="text-[color:var(--fg-muted)] font-mono text-xs">${esc(item.fullName)}</span></li>`)
    .join("")}</ul>`;
}

function packageEntries(pkg: DocPackage, kind: string, topLevel: boolean): SymbolIndexEntry[] {
  const names = new Set([pkg.fullName, pkg.packageName]);
  if (pkg.fullName === "(unnamed)" || pkg.packageName === "(unnamed)") names.add("");
  return index.symbolIndex.filter((entry) => {
    if (!names.has(entry.package) || entry.kind !== kind) return false;
    if (!topLevel) return true;
    const rest = entry.package ? entry.fullName.slice(entry.package.length + 1) : entry.fullName;
    return !rest.includes(".");
  });
}

function entriesById(ids: string[] | undefined): SymbolIndexEntry[] {
  return (ids ?? []).map((id) => byId.get(id)).filter((entry): entry is SymbolIndexEntry => Boolean(entry));
}

function reserved(names: string[] | undefined, ranges: { start: number; end: number }[] | undefined): string {
  const nameList = names ?? [];
  const rangeList = ranges ?? [];
  if (!nameList.length && !rangeList.length) return "";
  return `<p class="mt-4 text-sm text-[color:var(--fg-muted)]">Reserved ${esc([...nameList, ...rangeList.map((range) => `${range.start} to ${range.end}`)].join(", "))}</p>`;
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

function validationChips(options: DocOption[] | undefined): string[] {
  const chips: string[] = [];
  for (const option of options ?? []) {
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

function idsOf<T>(list: string[] | undefined, related: Record<string, DocSymbol>): T[] {
  return (list ?? []).map((id) => related[id] as T | undefined).filter((item): item is T => Boolean(item));
}

function crumb(fullName: string): string {
  return `<p class="text-sm text-[color:var(--fg-muted)]"><a href="${href("/")}">Home</a> / ${esc(fullName)}</p>`;
}

function pageTitle(path: string): string {
  if (path === "/") return index.title;
  const symbol = index.symbolIndex.find((item) => item.urlPath === path);
  return symbol ? `${symbol.name} · ${index.title}` : index.title;
}

function installShell() {
  const wkt = index.packages.filter((item) => item.domain === "well-known" && item.generatePage);
  app!.innerHTML = `
    <div class="lg:grid lg:grid-cols-[18rem_1fr] min-h-screen">
      <aside id="sidebar" class="hidden lg:flex flex-col border-r border-[color:var(--line)] bg-[color:var(--bg-raised)] px-4 py-5 gap-6">
        <a href="${href("/")}" class="no-underline text-[color:var(--fg)]"><div class="text-[11px] tracking-[0.12em] text-[color:var(--accent)] font-semibold">pbschema-lens</div><div class="text-lg font-semibold leading-tight mt-1">${esc(index.title)}</div></a>
        <nav id="side-nav" class="text-sm space-y-4 overflow-y-auto">
          <div><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">API Reference</div><div data-package-nav></div></div>
          ${wkt.length ? `<div><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">Protobuf standard library</div><ul class="space-y-1">${wkt.map((pkg) => `<li><a class="block rounded-md px-2 py-1 no-underline text-[color:var(--fg)]" href="${href(pkg.urlPath)}">${esc(pkg.fullName)}</a></li>`).join("")}</ul></div>` : ""}
          <div><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">Explore</div>
            <ul class="space-y-1">
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/explore/")}">Used-by explorer</a></li>
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/graph/")}">Package graph</a></li>
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/search/")}">Search</a></li>
              ${index.hasSource ? `<li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/source/")}">Source</a></li>` : ""}
              ${index.hasDiff ? `<li><a class="block px-2 py-1 no-underline text-[color:var(--fg)]" href="${href("/diff/")}">Schema diff</a></li>` : ""}
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
  input?.addEventListener("input", () => {
    void renderHits(input.value);
  });
  refreshPackageTree();
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

async function renderHits(query: string) {
  const box = document.getElementById("search-results");
  if (!box) return;
  const q = query.trim();
  if (!q) {
    box.innerHTML = "";
    return;
  }
  const hits: { entry: SymbolIndexEntry; score: number }[] = [];
  for (const entry of index.symbolIndex) {
    const score = rankSymbol(entry, q);
    if (score) hits.push({ entry, score });
  }
  if (fullText) {
    const comments = await loader.comments();
    const lower = q.toLowerCase();
    for (const [id, text] of Object.entries(comments)) {
      if (!text.toLowerCase().includes(lower)) continue;
      if (hits.some((hit) => hit.entry.id === id)) continue;
      const entry = byId.get(id);
      if (!entry) continue;
      hits.push({ entry, score: 15 });
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

function refreshPackageTree() {
  const local = index.packages.filter((item) => item.inNav && item.domain === "local");
  const tree = buildPackageNavTree(local.map((pkg) => ({ fullName: pkg.fullName, urlPath: pkg.urlPath })));
  const active = activePackageName(routePath(), local);
  const empty = local.length === 0 ? `<p class="text-[color:var(--fg-muted)] px-2">No local packages in this build.</p>` : "";
  const html = `${packageTreeHtml(tree, active, href)}${empty}`;
  document.querySelectorAll("[data-package-nav]").forEach((node) => {
    node.innerHTML = html;
  });
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

function hrefFor(url: string): string {
  if (isExternalHref(url)) return url;
  return href(url);
}

function href(urlPath: string): string {
  const [path, hash] = urlPath.split("#");
  const prefix = base === "/" ? "" : base.slice(0, -1);
  const joined = `${prefix}${path?.startsWith("/") ? path : `/${path ?? ""}`}`;
  return hash ? `${joined}#${hash}` : joined;
}

function esc(value: string | undefined): string {
  return (value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
