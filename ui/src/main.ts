import "../../site/src/styles/global.css";
import { rankSymbol } from "../../src/core/search.ts";
import type { SymbolIndexEntry } from "../../src/core/types.ts";
import { incomingReferencesHtml, symbolHitHtml } from "../../site/src/lib/search-ui.ts";
import { THEME_STORAGE_KEY, themeChoice, themeStorageValue, useDarkTheme } from "../../site/src/lib/theme.ts";
import { createLoader } from "./load.ts";

// Documentation, navigation, titles, and anchors are already in the HTML.
// Load JSON only when an interactive control needs it. Links use native navigation.
const base = readBase();
const fullText = document.documentElement.dataset.fullText !== "false";
const loader = createLoader(base);
let searchKind = "all";
let searchToken = 0;
document.querySelectorAll<HTMLElement>("[data-interactive]").forEach(control => control.hidden = false);
installControls();
installExplorer();

function installControls() {
  document.getElementById("menu-close")?.addEventListener("click", () => document.getElementById("mobile-nav")?.classList.add("hidden"));
  document.getElementById("menu-btn")?.addEventListener("click", () => {
    document.getElementById("mobile-nav")?.classList.remove("hidden");
  });
  document.getElementById("mobile-nav")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.id === "mobile-nav" || target.closest("a")) document.getElementById("mobile-nav")?.classList.add("hidden");
  });
  const themeButton = document.getElementById("theme-menu-button");
  const themeMenu = document.getElementById("theme-menu");
  const desktopTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const themeItems = () => [...(themeMenu?.querySelectorAll<HTMLButtonElement>("[data-theme-choice]") ?? [])];
  function setThemeMenuOpen(open: boolean) {
    if (!themeMenu || !themeButton) return;
    themeMenu.hidden = !open;
    themeButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) themeItems().find((item) => item.getAttribute("aria-checked") === "true")?.focus();
  }
  desktopTheme.addEventListener("change", () => {
    if (themeChoice(localStorage.getItem(THEME_STORAGE_KEY)) !== "system") return;
    applyTheme();
  });
  themeButton?.addEventListener("click", () => setThemeMenuOpen(themeMenu?.hidden !== false));
  themeMenu?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-theme-choice]");
    if (!item?.dataset.themeChoice) return;
    const value = themeStorageValue(item.dataset.themeChoice);
    if (value) localStorage.setItem(THEME_STORAGE_KEY, value);
    else localStorage.removeItem(THEME_STORAGE_KEY);
    applyTheme();
    setThemeMenuOpen(false);
    themeButton?.focus();
  });
  themeMenu?.addEventListener("keydown", (event) => {
    const items = themeItems();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? current + 1 : current - 1;
      items[(next + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!themeMenu || themeMenu.hidden) return;
    const target = event.target as Node;
    if (themeMenu.contains(target) || themeButton?.contains(target)) return;
    setThemeMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && themeMenu && !themeMenu.hidden) {
      setThemeMenuOpen(false);
      themeButton?.focus();
    }
  });
  applyTheme();
  const dialog = document.querySelector<HTMLDialogElement>("#search-dialog");
  const input = document.querySelector<HTMLInputElement>("#search-input");
  const filters = document.getElementById("search-filters");
  const kinds = ["all", "service", "method", "message", "field", "enum", "extension", "package"];
  for (const kind of kinds) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = kind;
    button.className = "rounded-full border border-[color:var(--line)] px-2 py-0.5 capitalize";
    button.dataset.kind = kind;
    button.addEventListener("click", () => {
      searchKind = kind;
      filters?.querySelectorAll("button").forEach((child) => child.classList.toggle("bg-[color:var(--bg-muted)]", child.dataset.kind === kind));
      void renderHits(input?.value ?? "").catch(showSearchError);
    });
    filters?.append(button);
  }
  filters?.querySelector("button")?.classList.add("bg-[color:var(--bg-muted)]");
  function openSearch() {
    setThemeMenuOpen(false);
    dialog?.showModal();
    input?.focus();
    void renderHits(input?.value ?? "").catch(showSearchError);
  }
  document.getElementById("search-form")?.addEventListener("submit", (event) => event.preventDefault());
  document.getElementById("search-open")?.addEventListener("click", openSearch);
  document.getElementById("search-close")?.addEventListener("click", () => dialog?.close());
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
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
    void renderHits(input.value).catch(showSearchError);
  });

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

function showSearchError(error: unknown) {
  const box = document.getElementById("search-results");
  if (box) box.textContent = error instanceof Error ? error.message : "Search data could not be loaded.";
}

async function renderHits(query: string) {
  const box = document.getElementById("search-results");
  if (!box) return;
  const token = ++searchToken;
  const q = query.trim();
  const kind = searchKind;
  if (!q) {
    box.innerHTML = `<p class="p-3 text-[color:var(--fg-muted)]">Type a protobuf name, or search comments.</p>`;
    return;
  }
  const index = await loader.index();
  const byId = new Map(index.symbolIndex.map(entry => [entry.id, entry]));
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
  if (token !== searchToken) return;
  box.innerHTML = symbolHtml || textHtml ? `${symbolHtml || `<p class="p-3">No symbol matches.</p>`}${textHtml}` : `<p class="p-3">No symbol matches.</p>`;
}

function installExplorer() {
  const select = document.querySelector<HTMLSelectElement>("#symbol-select");
  const out = document.getElementById("explorer-out");
  if (!select || !out) return;
  let token = 0;
  select.addEventListener("change", () => { void update().catch(error => {
    out.textContent = error instanceof Error ? error.message : "References could not be loaded.";
  }); });
  async function update() {
    const current = ++token;
    const [index, refs] = await Promise.all([loader.index(), loader.references()]);
    if (current !== token) return;
    const item = index.symbolIndex.find(entry => entry.id === select!.value);
    if (!item) { out!.textContent = ""; return; }
    const names = Object.fromEntries(index.symbolIndex.map(entry => [entry.id, entry.fullName]));
    const hrefs = Object.fromEntries(index.symbolIndex.map(entry => [entry.id, entry.urlPath ? href(entry.urlPath) : ""]));
    out!.innerHTML = incomingReferencesHtml(item.fullName, refs.filter(ref => ref.toId === item.id), names, hrefs, "");
  }
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

function esc(value: string | undefined): string {
  return (value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
