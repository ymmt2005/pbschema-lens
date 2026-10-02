import { packageNodeOpen, type PackageAreaCounts, type PackageAreaRow, type PackageNavNode } from "../../../src/core/package-nav.ts";
import { buildSourceTree, sourceNodeOpen, type SourceTreeFile, type SourceTreeNode } from "../../../src/core/source-tree.ts";
import { highlightProto } from "./highlight.ts";
import { repositoryLinkLabel } from "./repository-link.ts";

export type Href = (urlPath: string) => string;

const chevron = `<svg class="package-tree-chevron" viewBox="0 0 20 20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M7.5 4.5 13 10l-5.5 5.5"/></svg>`;

const fileIcon = `<svg class="source-tree-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4.2 2.4h4.6L12.2 5.8v7.2c0 .5-.4.9-1 .9H4.2c-.5 0-1-.4-1-.9V3.3c0-.5.5-.9 1-.9z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M8.6 2.6v3.4h3.4"/></svg>`;

const folderIcon = `<svg class="source-tree-icon source-tree-icon-folder" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.8 4.1c0-.7.6-1.3 1.3-1.3h3.1l1.2 1.3H13c.7 0 1.3.6 1.3 1.3v6.3c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.1z"/></svg>`;

function esc(value: string | undefined): string {
  return (value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function tally(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Singular when the count is one, matching the home area summary. */
export function areaCounts(counts: PackageAreaCounts): string {
  return `${tally(counts.packages, "package")} · ${tally(counts.services, "service")} · ${tally(counts.messages, "message")}`;
}

/** Sidebar and home package tree. Folders start closed; only ancestors of `active` open. */
export function packageTreeHtml(nodes: readonly PackageNavNode[], active: string | undefined, href: Href): string {
  return `<ul class="package-tree">${nodes.map((node) => packageNodeHtml(node, active, href)).join("")}</ul>`;
}

function packageNodeHtml(node: PackageNavNode, active: string | undefined, href: Href): string {
  const url = node.item ? href(node.item.urlPath) : undefined;
  const isActive = Boolean(node.item && node.item.fullName === active);
  const linkClass = isActive ? "package-tree-link is-active" : "package-tree-link";
  const current = isActive ? ` aria-current="page"` : "";
  if (node.children.length === 0) {
    return `<li><a class="${linkClass} package-tree-leaf" href="${esc(url ?? "")}"${current}>${esc(node.segment)}</a></li>`;
  }
  const open = packageNodeOpen(node.path, active) ? " open" : "";
  const label = url
    ? `<a class="${linkClass}" href="${esc(url)}"${current}>${esc(node.segment)}</a>`
    : `<span class="package-tree-folder">${esc(node.segment)}</span>`;
  return `<li><details class="package-tree-node"${open}><summary>${chevron}${label}</summary>${packageTreeHtml(node.children, active, href)}</details></li>`;
}

/** Home package cards. Branch rows start collapsed; a package with no children is a leaf link. */
export function homeAreasHtml(areas: readonly PackageAreaRow[], href: Href): string {
  if (areas.length === 0) {
    return `<p class="text-[color:var(--fg-muted)]">No project packages matched the documentation include rules.</p>`;
  }
  return `<ul class="space-y-2">${areas.map((area) => homeAreaHtml(area, href)).join("")}</ul>`;
}

function homeAreaHtml(area: PackageAreaRow, href: Href): string {
  const counts = `<span class="home-area-counts">${esc(areaCounts(area.counts))}</span>`;
  if (area.nodes.length === 0) {
    return `<li><a class="home-area home-area-leaf" href="${esc(href(area.urlPath ?? "/"))}"><span class="home-area-label"><span class="package-tree-chevron" aria-hidden="true"></span><span class="home-area-name">${esc(area.label)}</span></span>${counts}</a></li>`;
  }
  const name = area.urlPath
    ? `<a class="home-area-name" href="${esc(href(area.urlPath))}">${esc(area.label)}</a>`
    : area.label
      ? `<span class="home-area-name">${esc(area.label)}</span>`
      : "";
  return `<li><details class="home-area"><summary><span class="home-area-label">${chevron}${name}</span>${counts}</summary>${packageTreeHtml(area.nodes, undefined, href)}</details></li>`;
}

/** Source file tree. Directories start closed; only ancestors of `active` open. */
export function sourceTreeHtml(nodes: readonly SourceTreeNode[], active: string | undefined, href: Href): string {
  return `<ul class="source-tree">${nodes.map((node) => sourceNodeHtml(node, active, href)).join("")}</ul>`;
}

function sourceNodeHtml(node: SourceTreeNode, active: string | undefined, href: Href): string {
  const url = node.file ? href(node.file.urlPath) : undefined;
  const isActive = Boolean(node.file && node.file.fullName === active);
  const current = isActive ? ` aria-current="page"` : "";
  if (node.kind === "file") {
    const activeClass = isActive ? " is-active" : "";
    return `<li><a class="source-tree-file${activeClass}" href="${esc(url ?? "")}"${current}>${fileIcon}<span>${esc(node.segment)}</span></a></li>`;
  }
  const open = sourceNodeOpen(node.path, active) ? " open" : "";
  const activeClass = isActive ? ` class="is-active"` : "";
  const label = url
    ? `<a${activeClass} href="${esc(url)}"${current}>${esc(node.segment)}</a>`
    : `<span>${esc(node.segment)}</span>`;
  return `<li><details class="source-tree-node"${open}><summary>${folderIcon}${label}</summary>${sourceTreeHtml(node.children, active, href)}</details></li>`;
}

export function sourceExplorerHtml(files: readonly SourceTreeFile[], active: string | undefined, main: string, href: Href): string {
  const nodes = buildSourceTree(files);
  const tree =
    nodes.length > 0
      ? `<nav class="source-explorer-tree" aria-label="Proto files"><div class="source-explorer-label">Files</div>${sourceTreeHtml(nodes, active, href)}</nav>`
      : "";
  const mode = active ? "is-split" : "is-index";
  return `<div class="source-explorer ${mode}">${tree}<div class="source-explorer-main">${main}</div></div>`;
}

export function sourceIndexHtml(files: readonly SourceTreeFile[], href: Href): string {
  if (files.length === 0) {
    return `<div><h1 class="text-3xl font-semibold mb-4">Source</h1><p>No source text was available. Descriptor-only builds omit the source browser.</p></div>`;
  }
  const intro = `<h1 class="text-3xl font-semibold mb-2">Source</h1><p class="text-[color:var(--fg-muted)]">Browse the embedded .proto files for this schema.</p>`;
  return sourceExplorerHtml(files, undefined, intro, href);
}

export interface SourceFileView {
  fullName: string;
  syntax: string;
  edition?: string;
  packageName: string;
  sourceText?: string;
  repositoryLink?: { url: string };
}

export function sourceFilePageHtml(file: SourceFileView, files: readonly SourceTreeFile[], href: Href): string {
  const parts = file.fullName.split("/").filter((part) => part.length > 0);
  const filename = parts.at(-1) ?? file.fullName;
  const dirs = parts.slice(0, -1);
  const crumb = dirs.length ? `<ol class="source-crumb">${dirs.map((dir) => `<li>${esc(dir)}</li>`).join("")}</ol>` : "";
  const edition = file.edition ? ` · edition ${esc(file.edition)}` : "";
  const repo = file.repositoryLink
    ? `<p class="mt-3"><a href="${esc(file.repositoryLink.url)}">${esc(repositoryLinkLabel(file.repositoryLink.url))}</a></p>`
    : "";
  const lines = (file.sourceText ?? "").split(/\r?\n/);
  const body = lines
    .map((line, index) => {
      const n = index + 1;
      return `<div id="L${n}" class="source-line flex gap-3 px-3 hover:bg-[color:var(--bg-muted)]"><a class="w-10 shrink-0 text-right text-[color:var(--fg-muted)] no-underline select-none" href="#L${n}">${n}</a><code class="whitespace-pre grow">${highlightProto(line.length ? line : " ")}</code></div>`;
    })
    .join("");
  const main = `
    <p class="text-xs uppercase tracking-wider text-[color:var(--accent)] font-semibold">Source</p>
    ${crumb}
    <h1 class="text-2xl font-semibold mt-1 break-all">${esc(filename)}</h1>
    <p class="text-sm text-[color:var(--fg-muted)] mt-2">${esc(file.syntax)}${edition} · package ${esc(file.packageName || "(unnamed)")}</p>
    ${repo}
    <div class="source-view mt-6 font-mono text-[0.8rem] leading-6 border border-[color:var(--line)] rounded-xl overflow-x-auto bg-[color:var(--bg-raised)]">${body}</div>
  `;
  return sourceExplorerHtml(files, file.fullName, main, href);
}
