import "../../site/src/styles/global.css";
import { activePackageName, buildPackageNavTree, homePackageAreas } from "../../src/core/package-nav.ts";
import {
  diffPageHtml,
  enumPageHtml,
  explorePageHtml,
  extensionPageHtml,
  graphPageHtml,
  homeWarningsHtml,
  messagePageHtml,
  methodPageHtml,
  packagePageHtml,
  searchPageHtml,
  servicePageHtml,
  type PageContext,
} from "../../site/src/lib/pages.ts";
import { homeAreasHtml, packageTreeHtml, sourceFilePageHtml, sourceIndexHtml } from "../../site/src/lib/trees.ts";
import { rankSymbol } from "../../src/core/search.ts";
import type { DocEnum, DocExtension, DocFile, DocMessage, DocMethod, DocPackage, DocService, DocSymbol, SymbolIndexEntry, SymbolReference } from "../../src/core/types.ts";
import { isExternalHref } from "../../site/src/lib/repository-link.ts";
import { incomingReferencesHtml, symbolHitHtml } from "../../site/src/lib/search-ui.ts";
import { THEME_CHOICES, THEME_STORAGE_KEY, themeChoice, themeStorageValue, useDarkTheme } from "../../site/src/lib/theme.ts";
import { createLoader, type Loader, type SiteIndex } from "./load.ts";

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
  bindPage(path);
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

function pageContext(): PageContext {
  return {
    href,
    byId: new Map(
      index.symbolIndex.map((entry) => [
        entry.id,
        { id: entry.id, name: entry.name, fullName: entry.fullName, urlPath: entry.urlPath, kind: entry.kind, shard: entry.shard },
      ]),
    ),
    packageByName: new Map(index.packages.map((pkg) => [pkg.fullName, pkg])),
    fileByName: new Map(index.files.map((file) => [file.fullName, file])),
  };
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
    ${homeWarningsHtml(index.buildInfo.warnings)}
  `;
}

function renderPackage(pkg: DocPackage): string {
  return packagePageHtml(pkg, pageContext());
}

function renderMessage(message: DocMessage, related: Record<string, DocSymbol>): string {
  return messagePageHtml(message, related, index.wktNotes[message.fullName], pageContext());
}

function renderEnum(doc: DocEnum, related: Record<string, DocSymbol>): string {
  return enumPageHtml(doc, related, index.wktNotes[doc.fullName], pageContext());
}

function renderService(service: DocService, related: Record<string, DocSymbol>): string {
  return servicePageHtml(service, related, pageContext());
}

function renderMethod(method: DocMethod, related: Record<string, DocSymbol>): string {
  return methodPageHtml(method, related, pageContext());
}

function renderExtension(ext: DocExtension): string {
  return extensionPageHtml(ext, pageContext());
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
  return searchPageHtml(index.symbolIndex.length, index.packages.length);
}

let exploreIncoming = new Map<string, SymbolReference[]>();
let searchKind = "all";

async function renderExplore(): Promise<string> {
  const refs = await loader.references();
  exploreIncoming = new Map();
  for (const ref of refs) {
    const list = exploreIncoming.get(ref.toId) ?? [];
    list.push(ref);
    exploreIncoming.set(ref.toId, list);
  }
  return explorePageHtml(index.symbolIndex.filter((entry) => entry.shard));
}

async function renderGraph(): Promise<string> {
  const graph = await loader.graph();
  return graphPageHtml(graph.nodes, graph.edges, href);
}

async function renderDiff(): Promise<string> {
  if (!index.hasDiff) return diffPageHtml(undefined);
  return diffPageHtml(await loader.diff());
}

function bindPage(path: string) {
  if (path !== "/explore/") return;
  const select = document.getElementById("symbol-select") as HTMLSelectElement | null;
  const out = document.getElementById("explorer-out");
  const names = Object.fromEntries(index.symbolIndex.map((entry) => [entry.id, entry.fullName]));
  const hrefs = Object.fromEntries(index.symbolIndex.map((entry) => [entry.id, entry.urlPath ? href(entry.urlPath) : ""]));
  select?.addEventListener("change", () => {
    if (!out || !select) return;
    const item = index.symbolIndex.find((entry) => entry.id === select.value);
    if (!item) {
      out.innerHTML = "";
      return;
    }
    out.innerHTML = incomingReferencesHtml(item.fullName, exploreIncoming.get(item.id) ?? [], names, hrefs, "");
  });
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
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)] hover:bg-[color:var(--bg-muted)] rounded-md" href="${href("/explore/")}">Used-by explorer</a></li>
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)] hover:bg-[color:var(--bg-muted)] rounded-md" href="${href("/graph/")}">Package graph</a></li>
              <li><a class="block px-2 py-1 no-underline text-[color:var(--fg)] hover:bg-[color:var(--bg-muted)] rounded-md" href="${href("/search/")}">Search</a></li>
              ${index.hasSource ? `<li><a class="block px-2 py-1 no-underline text-[color:var(--fg)] hover:bg-[color:var(--bg-muted)] rounded-md" href="${href("/source/")}">Source</a></li>` : ""}
              ${index.hasDiff ? `<li><a class="block px-2 py-1 no-underline text-[color:var(--fg)] hover:bg-[color:var(--bg-muted)] rounded-md" href="${href("/diff/")}">Schema diff</a></li>` : ""}
            </ul>
          </div>
        </nav>
      </aside>
      <div class="min-w-0">
        <header class="sticky top-0 z-20 border-b border-[color:var(--line)] bg-[color:var(--bg)]/90 backdrop-blur">
          <div class="flex items-center gap-3 px-4 py-3">
            <button id="menu-btn" class="lg:hidden rounded-md border border-[color:var(--line)] px-2 py-1 text-sm" type="button">Menu</button>
            <button id="search-open" class="flex-1 text-left rounded-md border border-[color:var(--line)] bg-[color:var(--bg-raised)] px-3 py-2 text-sm text-[color:var(--fg-muted)]" type="button">Search symbols and comments… <kbd class="hidden sm:inline float-right text-[11px] border border-[color:var(--line)] rounded px-1">/</kbd></button>
            <div class="relative shrink-0">
              <button id="theme-menu-button" class="rounded-md border border-[color:var(--line)] px-2 py-1 text-sm" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu">Theme</button>
              <div id="theme-menu" class="absolute right-0 z-30 mt-1 min-w-44 rounded-md border border-[color:var(--line)] bg-[color:var(--bg-raised)] py-1 text-sm shadow-[var(--shadow)]" role="menu" aria-label="Theme" hidden>
                ${THEME_CHOICES.map((choice) => `<button class="grid w-full grid-cols-[1rem_1fr] items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-[color:var(--fg)] hover:bg-[color:var(--bg-muted)] aria-checked:bg-[color:var(--bg-muted)]" type="button" role="menuitemradio" data-theme-choice="${choice.value}" aria-checked="false"><span class="theme-mark text-[color:var(--accent)]" aria-hidden="true"></span>${choice.label}</button>`).join("")}
              </div>
            </div>
          </div>
        </header>
        <main id="main" class="w-full min-w-0 px-4 py-8 sm:px-8"></main>
      </div>
    </div>
    <div id="mobile-nav" class="hidden fixed inset-0 z-30 bg-black/50 lg:hidden"><div id="mobile-panel" class="h-full w-72 bg-[color:var(--bg-raised)] p-4 overflow-y-auto"></div></div>
    <dialog id="search-dialog" class="w-[min(720px,92vw)] rounded-xl border border-[color:var(--line)] bg-[color:var(--bg-raised)] p-0 text-[color:var(--fg)] shadow-[var(--shadow)]">
      <div class="p-3 border-b border-[color:var(--line)]"><input id="search-input" class="w-full bg-transparent outline-none text-base" placeholder="Search symbols, comments, options…" /><div id="search-filters" class="flex flex-wrap gap-1 mt-2 text-xs"></div></div>
      <div id="search-results" class="max-h-[60vh] overflow-y-auto p-2 text-sm"></div>
    </dialog>
    ${siteUrl ? `<link rel="canonical" href="${esc(siteUrl)}" />` : ""}
  `;
  document.getElementById("menu-btn")?.addEventListener("click", () => {
    const panel = document.getElementById("mobile-panel");
    const nav = document.querySelector("[data-package-nav]");
    if (panel) {
      panel.innerHTML = `<button id="menu-close" class="mb-4 text-sm" type="button">Close</button><a href="${href("/")}" class="block font-semibold mb-4 no-underline text-[color:var(--fg)]">${esc(index.title)}</a><div class="text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)] mb-2">API Reference</div><div data-package-nav>${nav?.innerHTML ?? ""}</div>`;
      document.getElementById("menu-close")?.addEventListener("click", () => document.getElementById("mobile-nav")?.classList.add("hidden"));
    }
    document.getElementById("mobile-nav")?.classList.remove("hidden");
  });
  document.getElementById("mobile-nav")?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).id === "mobile-nav") document.getElementById("mobile-nav")?.classList.add("hidden");
  });
  const themeButton = document.getElementById("theme-menu-button");
  const themeMenu = document.getElementById("theme-menu");
  themeButton?.addEventListener("click", () => {
    if (!themeMenu || !themeButton) return;
    themeMenu.hidden = !themeMenu.hidden;
    themeButton.setAttribute("aria-expanded", themeMenu.hidden ? "false" : "true");
  });
  themeMenu?.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest("[data-theme-choice]")?.getAttribute("data-theme-choice");
    if (!choice) return;
    const stored = themeStorageValue(choice);
    if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
    else localStorage.removeItem(THEME_STORAGE_KEY);
    applyTheme();
    if (themeMenu) themeMenu.hidden = true;
    themeButton?.setAttribute("aria-expanded", "false");
  });
  applyTheme();
  const dialog = document.querySelector<HTMLDialogElement>("#search-dialog");
  const input = document.querySelector<HTMLInputElement>("#search-input");
  const filters = document.getElementById("search-filters");
  const kinds = ["all", "service", "method", "message", "field", "enum", "extension", "package"];
  for (const kind of kinds) {
    const button = document.createElement("button");
    button.textContent = kind;
    button.className = "rounded-full border border-[color:var(--line)] px-2 py-0.5 capitalize";
    button.dataset.kind = kind;
    button.addEventListener("click", () => {
      searchKind = kind;
      filters?.querySelectorAll("button").forEach((child) => child.classList.toggle("bg-[color:var(--bg-muted)]", child.dataset.kind === kind));
      void renderHits(input?.value ?? "");
    });
    filters?.append(button);
  }
  filters?.querySelector("button")?.classList.add("bg-[color:var(--bg-muted)]");
  function openSearch() {
    dialog?.showModal();
    input?.focus();
    void renderHits(input?.value ?? "");
  }
  document.getElementById("search-open")?.addEventListener("click", openSearch);
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
      event.preventDefault();
      openSearch();
    }
    if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openSearch();
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
  const kind = searchKind;
  if (!q) {
    box.innerHTML = `<p class="p-3 text-[color:var(--fg-muted)]">Type a protobuf name, or search comments.</p>`;
    return;
  }
  const allowed = (entry: SymbolIndexEntry) => kind === "all" || entry.kind === kind;
  const hits: { entry: SymbolIndexEntry; score: number; text: boolean }[] = [];
  for (const entry of index.symbolIndex) {
    if (!allowed(entry)) continue;
    const score = rankSymbol(entry, q);
    if (score) hits.push({ entry, score, text: false });
  }
  const textHits: SymbolIndexEntry[] = [];
  if (fullText) {
    const comments = await loader.comments();
    const lower = q.toLowerCase();
    for (const [id, text] of Object.entries(comments)) {
      if (!text.toLowerCase().includes(lower)) continue;
      if (hits.some((hit) => hit.entry.id === id)) continue;
      const entry = byId.get(id);
      if (!entry || !allowed(entry)) continue;
      textHits.push(entry);
    }
  }
  hits.sort((a, b) => b.score - a.score || a.entry.fullName.localeCompare(b.entry.fullName));
  const symbolHtml = hits
    .slice(0, 20)
    .map(
      (hit) =>
        `<a class="block rounded-md px-3 py-2 hover:bg-[color:var(--bg-muted)] no-underline text-[color:var(--fg)]" href="${href(hit.entry.urlPath)}">${symbolHitHtml(hit.entry.kind, hit.entry.fullName)}</a>`,
    )
    .join("");
  const textHtml = textHits.length
    ? `<div class="px-3 pt-3 text-[11px] uppercase tracking-wider text-[color:var(--fg-muted)]">Full-text</div>${textHits
        .slice(0, 8)
        .map(
          (entry) =>
            `<a class="block rounded-md px-3 py-2 hover:bg-[color:var(--bg-muted)] no-underline text-[color:var(--fg)]" href="${href(entry.urlPath)}">${symbolHitHtml(entry.kind, entry.fullName)}</a>`,
        )
        .join("")}`
    : "";
  box.innerHTML = symbolHtml || textHtml ? `${symbolHtml || `<p class="p-3">No symbol matches.</p>`}${textHtml}` : `<p class="p-3">No symbol matches.</p>`;
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
