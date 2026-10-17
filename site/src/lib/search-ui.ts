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
  limit = 200,
): string {
  if (!refs.length) {
    return `<p>No incoming references for <strong>${escapeHtml(fullName)}</strong>.</p>`;
  }
  const items = refs
    .slice(0, limit)
    .map((ref) => {
      const href = hrefs[ref.fromId];
      const name = escapeHtml(names[ref.fromId] ?? ref.fromId);
      const label = href
        ? `<a href="${escapeHtml(prefix + href)}">${name}</a>`
        : `<span class="font-mono">${name}</span>`;
      return `<li>${label} <span class="text-[color:var(--fg-muted)]">· ${escapeHtml(ref.kind)}</span></li>`;
    })
    .join("");
  const more = refs.length > limit
    ? `<p class="mt-3">Showing ${limit} of ${refs.length} references.</p><button type="button" data-more-references class="mt-2 rounded-md border border-[color:var(--line)] px-3 py-1">Show more references</button>`
    : "";
  return `<p class="mb-3">${refs.length} incoming reference(s)</p><ul class="space-y-1">${items}</ul>${more}`;
}
