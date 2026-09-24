import { escapeHtml } from "../../../src/core/markdown.ts";

export function symbolHitHtml(kind: string, fullName: string): string {
  return `<div class="font-mono text-xs text-[color:var(--fg-muted)]">${escapeHtml(kind)}</div><div>${escapeHtml(fullName)}</div>`;
}

export function pagefindHitHtml(title: string, excerpt: string): string {
  return `<div>${escapeHtml(title)}</div><div class="text-xs text-[color:var(--fg-muted)]">${escapeHtml(excerpt)}</div>`;
}

export function incomingReferencesHtml(
  fullName: string,
  refs: Array<{ fromId: string; kind: string }>,
  names: Record<string, string>,
  hrefs: Record<string, string>,
  prefix: string,
): string {
  if (!refs.length) {
    return `<p>No incoming references for <strong>${escapeHtml(fullName)}</strong>.</p>`;
  }
  const items = refs
    .slice(0, 200)
    .map((ref) => {
      const href = hrefs[ref.fromId];
      const name = escapeHtml(names[ref.fromId] ?? ref.fromId);
      const label = href
        ? `<a href="${escapeHtml(prefix + href)}">${name}</a>`
        : `<span class="font-mono">${name}</span>`;
      return `<li>${label} <span class="text-[color:var(--fg-muted)]">· ${escapeHtml(ref.kind)}</span></li>`;
    })
    .join("");
  return `<p class="mb-3">${refs.length} incoming reference(s)</p><ul class="space-y-1">${items}</ul>`;
}
