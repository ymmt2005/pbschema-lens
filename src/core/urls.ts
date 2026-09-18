import type { SymbolKind } from "./types.js";
import { slug } from "./ids.js";

export function urlPathFor(
  kind: SymbolKind,
  fullName: string,
  parentFullName?: string,
): { urlPath: string; anchor?: string } {
  switch (kind) {
    case "package":
      return { urlPath: `/reference/packages/${encodeURIComponent(fullName)}/` };
    case "message":
      return { urlPath: `/reference/messages/${encodeURIComponent(fullName)}/` };
    case "enum":
      return { urlPath: `/reference/enums/${encodeURIComponent(fullName)}/` };
    case "service":
      return { urlPath: `/reference/services/${encodeURIComponent(fullName)}/` };
    case "extension":
      return { urlPath: `/reference/extensions/${encodeURIComponent(fullName)}/` };
    case "file":
      return { urlPath: `/source/${fullName.split("/").map(encodeURIComponent).join("/")}/` };
    case "field":
    case "oneof":
      return {
        urlPath: `/reference/messages/${encodeURIComponent(parentFullName ?? fullName)}/`,
        anchor: kind === "oneof" ? `oneof-${slug(shortName(fullName))}` : slug(shortName(fullName)),
      };
    case "method":
      return {
        urlPath: `/reference/services/${encodeURIComponent(parentFullName ?? fullName)}/`,
        anchor: slug(shortName(fullName)),
      };
    case "enum-value":
      return {
        urlPath: `/reference/enums/${encodeURIComponent(parentFullName ?? fullName)}/`,
        anchor: slug(shortName(fullName)),
      };
  }
}

export interface SourceLinkConfig {
  repository?: string;
  commit?: string;
  urlTemplate?: string;
}

export function fileSourcePath(fileName: string, line?: number): string {
  const { urlPath } = urlPathFor("file", fileName);
  return line ? `${urlPath}#L${line}` : urlPath;
}

export function repositoryBlobUrl(
  config: SourceLinkConfig | undefined,
  fileName: string,
  line: number,
): string | undefined {
  if (!config) {
    return undefined;
  }
  if (config.urlTemplate) {
    return config.urlTemplate
      .replaceAll("{file}", fileName)
      .replaceAll("{line}", String(line))
      .replaceAll("{commit}", config.commit ?? "HEAD");
  }
  const repo = config.repository ?? "";
  const commit = config.commit ?? "HEAD";
  const github =
    repo.match(/^github:([^/]+\/[^/]+)$/) ?? repo.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (github) {
    return `https://github.com/${github[1]}/blob/${commit}/${fileName}#L${line}`;
  }
  const gitlab =
    repo.match(/^gitlab:([^/]+\/.+)$/) ?? repo.match(/^https?:\/\/gitlab\.com\/(.+?)(?:\.git)?\/?$/);
  if (gitlab) {
    return `https://gitlab.com/${gitlab[1].replace(/\/$/, "")}/-/blob/${commit}/${fileName}#L${line}`;
  }
  return undefined;
}

export function href(urlPath: string, anchor?: string): string {
  return anchor ? `${urlPath}#${anchor}` : urlPath;
}

export function withBase(base: string, urlPath: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!normalizedBase || normalizedBase === "/") {
    return urlPath;
  }
  return `${normalizedBase}${urlPath}`;
}

function shortName(fullName: string): string {
  const parts = fullName.split(".");
  return parts[parts.length - 1] ?? fullName;
}
