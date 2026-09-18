import type { SourceCodeInfo_Location } from "@bufbuild/protobuf/wkt";
import type { DocComment, SourceLocation } from "./types.js";
import { commentsToMarkdown, renderSafeMarkdown } from "./markdown.js";

export function pathKey(path: readonly number[]): string {
  return path.join("/");
}

export function indexLocations(
  locations: readonly SourceCodeInfo_Location[] | undefined,
): Map<string, SourceCodeInfo_Location> {
  const map = new Map<string, SourceCodeInfo_Location>();
  if (!locations) {
    return map;
  }
  for (const location of locations) {
    const key = pathKey(location.path);
    if (!map.has(key)) {
      map.set(key, location);
    }
  }
  return map;
}

export function locationToSource(fileName: string, location?: SourceCodeInfo_Location): SourceLocation | undefined {
  if (!location || location.span.length < 2) {
    return undefined;
  }
  const [startLine, startColumn, endLineOrCol, endColumn] = location.span;
  const hasFour = location.span.length >= 4;
  return {
    fileName,
    startLine: (startLine ?? 0) + 1,
    startColumn: (startColumn ?? 0) + 1,
    endLine: (hasFour ? (endLineOrCol ?? startLine ?? 0) : (startLine ?? 0)) + 1,
    endColumn: (hasFour ? (endColumn ?? 0) : (endLineOrCol ?? 0)) + 1,
  };
}

export function locationToComment(location?: SourceCodeInfo_Location): DocComment | undefined {
  if (!location) {
    return undefined;
  }
  const leading = normalizeComment(location.leadingComments);
  const trailing = normalizeComment(location.trailingComments);
  const detached = location.leadingDetachedComments.map(normalizeComment).filter(Boolean);
  if (!leading && !trailing && detached.length === 0) {
    return undefined;
  }
  const markdown = commentsToMarkdown([detached.join("\n\n"), leading, trailing]);
  return {
    leading: leading || undefined,
    trailing: trailing || undefined,
    detached,
    markdownHtml: renderSafeMarkdown(markdown),
  };
}

export function commentsFor(
  index: Map<string, SourceCodeInfo_Location>,
  path: readonly number[],
): { comments?: DocComment; source?: Omit<SourceLocation, "fileName"> & { fileName?: string } } {
  const location = index.get(pathKey(path));
  return {
    comments: locationToComment(location),
    source: location ? locationToSource("", location) : undefined,
  };
}

function normalizeComment(text: string | undefined): string {
  if (!text) {
    return "";
  }
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\*\s?/gm, "")
    .trim();
}
