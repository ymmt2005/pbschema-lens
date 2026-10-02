import type { DocFile, DocSymbol, SchemaDiff, SymbolIndexEntry, SymbolReference } from "../../src/core/types.ts";

export interface PackageCard {
  id: string;
  fullName: string;
  urlPath: string;
  domain: string;
  generatePage: boolean;
  inNav: boolean;
  services: number;
  messages: number;
  enums: number;
  extensions: number;
}

export interface FileCard {
  id: string;
  fullName: string;
  urlPath: string;
  syntax: string;
  edition?: string;
  generatePage: boolean;
  hasSource: boolean;
}

export interface SiteIndex {
  title: string;
  buildInfo: { symbolCount: number; fileCount: number };
  packages: PackageCard[];
  files: FileCard[];
  symbolIndex: SymbolIndexEntry[];
  wktNotes: Record<string, string>;
  diff?: SchemaDiff;
  hasSource: boolean;
  localServices: number;
  customOptions: number;
}

export interface SymbolPage {
  symbol: DocSymbol;
  related: Record<string, DocSymbol>;
}

export interface GraphNode {
  id: string;
  fullName: string;
  urlPath: string;
  generatePage: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  public: boolean;
}

export interface PackageGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Loader {
  index(): Promise<SiteIndex>;
  symbol(id: string): Promise<SymbolPage>;
  source(path: string): Promise<DocFile>;
  graph(): Promise<PackageGraph>;
  comments(): Promise<Record<string, string>>;
  references(): Promise<SymbolReference[]>;
}

export function createLoader(base: string): Loader {
  let indexCache: SiteIndex | undefined;
  const symbols = new Map<string, SymbolPage>();
  const sources = new Map<string, DocFile>();
  let graphCache: PackageGraph | undefined;
  let commentsCache: Record<string, string> | undefined;
  let referencesCache: SymbolReference[] | undefined;

  return {
    async index() {
      if (indexCache) return indexCache;
      const response = await fetch(asset(base, "assets/model/index.json"));
      if (!response.ok) throw new Error("missing index");
      const index = (await response.json()) as SiteIndex;
      index.packages = index.packages ?? [];
      index.files = index.files ?? [];
      index.symbolIndex = index.symbolIndex ?? [];
      index.wktNotes = index.wktNotes ?? {};
      indexCache = index;
      return index;
    },
    async symbol(id: string) {
      const cached = symbols.get(id);
      if (cached) return cached;
      const response = await fetch(asset(base, `assets/model/symbols/${pathEscape(id)}.json`));
      if (!response.ok) throw new Error(`missing symbol ${id}`);
      const page = (await response.json()) as SymbolPage;
      page.related = page.related ?? {};
      symbols.set(id, page);
      return page;
    },
    async source(path: string) {
      const cached = sources.get(path);
      if (cached) return cached;
      const response = await fetch(asset(base, `assets/model/source/${pathEscape(path)}.json`));
      if (!response.ok) throw new Error(`missing source ${path}`);
      const file = (await response.json()) as DocFile;
      sources.set(path, file);
      return file;
    },
    async graph() {
      if (graphCache) return graphCache;
      const response = await fetch(asset(base, "assets/model/graph.json"));
      if (!response.ok) throw new Error("missing graph");
      const graph = (await response.json()) as PackageGraph;
      graph.nodes = graph.nodes ?? [];
      graph.edges = graph.edges ?? [];
      graphCache = graph;
      return graph;
    },
    async comments() {
      if (commentsCache) return commentsCache;
      const response = await fetch(asset(base, "assets/model/comments.json"));
      commentsCache = response.ok ? ((await response.json()) as Record<string, string>) : {};
      return commentsCache;
    },
    async references() {
      if (referencesCache) return referencesCache;
      const response = await fetch(asset(base, "assets/protobuf/references.json"));
      referencesCache = response.ok ? ((await response.json()) as SymbolReference[]) : [];
      return referencesCache ?? [];
    },
  };
}

export function asset(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base}${name}`;
}

/** Match site.fileToken: percent-encode every byte except RFC 3986 unreserved characters. */
export function pathEscape(value: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(value)) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(char)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}
