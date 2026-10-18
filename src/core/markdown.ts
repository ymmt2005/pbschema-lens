import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
  "p",
  "br",
  "b",
  "i",
  "em",
  "strong",
  "code",
  "pre",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "span",
];

export function commentsToMarkdown(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => {
      part = part.replace(/\r\n/g, "\n");
      const trimmed = part.trim();
      if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) {
        part = trimmed.replace(/^\/\*\*?/, "").replace(/\*\/$/, "");
        const body = part.split("\n").slice(1).filter(line => Boolean(line.trim()));
        if (body.length && body.every(line => /^[\t ]*\*(?:[\t ]|$)/.test(line))) {
          part = part.replace(/^[\t ]*\*(?:[\t ]|$)/gm, "");
        }
      } else {
        const first = part.indexOf("\n");
        if (first >= 0 && part.slice(0, first).trim() === "*") part = part.slice(first + 1);
      }
      let lines = part.replace(/^\n+|\n+$/g, "").split("\n");
      if (lines.every(line => !line.trim() || line.startsWith(" "))) {
        lines = lines.map(line => line.replace(/^ /, ""));
      }
      return lines.join("\n").replace(/[ \t]+$/, "").replace(/^\n+|\n+$/g, "");
    })
    .filter(part => Boolean(part.trim()))
    .join("\n\n");
}

export function renderSafeMarkdown(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }
  const html = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "rel", "target"],
      code: ["class"],
      span: ["class"],
      th: ["align"],
      td: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
      // Normalize both Markdown and raw HTML headings beneath the page title.
      // The tag/attribute allowlists and URL filtering above remain unchanged.
      ...Object.fromEntries([1, 2, 3, 4, 5].map(level => [
        `h${level}`, sanitizeHtml.simpleTransform(`h${level + 1}`, {}),
      ])),
    },
    disallowedTagsMode: "discard",
  });
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
