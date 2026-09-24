import { minimatch } from "minimatch";
import type { DescriptorDomain, SymbolKind } from "./types.js";
import { isWktFile, isWktPackage, HIDDEN_WKT_FILES } from "./wkt.js";

export interface ClassificationConfig {
  include?: string[];
  exclude?: string[];
  localFiles?: Set<string>;
  externalLinks?: { package: string; urlTemplate: string }[];
  /** When false, well-known types stay in the model but get no pages or nav entries. Defaults to true. */
  wellKnownTypes?: boolean;
}

export interface Classification {
  domain: DescriptorDomain;
  generatePage: boolean;
  inNav: boolean;
  externalUrl?: string;
}

export function classifyFile(
  fileName: string,
  packageName: string,
  config: ClassificationConfig,
): Classification {
  if (isWktFile(fileName) || isWktPackage(packageName)) {
    const hidden = config.wellKnownTypes === false || HIDDEN_WKT_FILES.has(fileName);
    return { domain: "well-known", generatePage: !hidden, inNav: !hidden };
  }

  const external = matchExternal(packageName, config.externalLinks);
  if (external) {
    return {
      domain: "external-documented",
      generatePage: false,
      inNav: false,
      externalUrl: external,
    };
  }

  if (isExcludedPath(fileName, packageName, config.exclude)) {
    return { domain: "external-undocumented", generatePage: false, inNav: false };
  }

  if (config.include && config.include.length > 0) {
    if (isIncluded(fileName, packageName, config.include)) {
      return { domain: "local", generatePage: true, inNav: true };
    }
    return { domain: "external-undocumented", generatePage: false, inNav: false };
  }

  if (config.localFiles && config.localFiles.size > 0) {
    if (config.localFiles.has(fileName)) {
      return { domain: "local", generatePage: true, inNav: true };
    }
    return { domain: "external-undocumented", generatePage: false, inNav: false };
  }

  return { domain: "local", generatePage: true, inNav: true };
}

export function resolveExternalUrl(
  fullName: string,
  kind: SymbolKind,
  config: ClassificationConfig,
): string | undefined {
  for (const rule of config.externalLinks ?? []) {
    if (matchPackagePattern(fullName, rule.package) || matchPackagePattern(packageOf(fullName), rule.package)) {
      return rule.urlTemplate
        .replaceAll("{symbol}", encodeURIComponent(fullName))
        .replaceAll("{kind}", kind)
        .replaceAll("{package}", encodeURIComponent(packageOf(fullName)));
    }
  }
  return undefined;
}

export function isExcludedPath(fileName: string, packageName: string, patterns?: string[]): boolean {
  return (patterns ?? []).some((pattern) => matches(fileName, packageName, pattern));
}

function isIncluded(fileName: string, packageName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matches(fileName, packageName, pattern));
}

function matches(fileName: string, packageName: string, pattern: string): boolean {
  return minimatch(fileName, pattern) || matchPackagePattern(packageName, pattern);
}

function matchPackagePattern(name: string, pattern: string): boolean {
  const glob = pattern.endsWith(".**")
    ? `${pattern.slice(0, -3)}.**`
    : pattern;
  return minimatch(name, glob, { dot: true }) || name === pattern.replace(/\.\*\*$/, "");
}

function matchExternal(
  packageName: string,
  rules?: { package: string; urlTemplate: string }[],
): string | undefined {
  for (const rule of rules ?? []) {
    if (matchPackagePattern(packageName, rule.package)) {
      return rule.urlTemplate.replaceAll("{package}", encodeURIComponent(packageName));
    }
  }
  return undefined;
}

function packageOf(fullName: string): string {
  const parts = fullName.split(".");
  return parts.slice(0, -1).join(".");
}
