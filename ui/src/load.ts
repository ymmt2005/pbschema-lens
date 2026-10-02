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
  sourceShard?: string;
}

export interface SiteIndex {
  title: string;
  buildInfo: { symbolCount: number; fileCount: number };
  packages: PackageCard[];
  files: FileCard[];
  symbolIndex: SymbolIndexEntry[];
  wktNotes: Record<string, string>;
  hasDiff: boolean;
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
  diff(): Promise<SchemaDiff>;
}

export function createLoader(base: string): Loader {
  let indexCache: SiteIndex | undefined;
  const symbols = new Map<string, SymbolPage>();
  const sources = new Map<string, DocFile>();
  let graphCache: PackageGraph | undefined;
  let commentsCache: Record<string, string> | undefined;
  let referencesCache: SymbolReference[] | undefined;
  let diffCache: SchemaDiff | undefined;

  async function loadIndex(): Promise<SiteIndex> {
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
  }

  return {
    index: loadIndex,
    async symbol(id: string) {
      const cached = symbols.get(id);
      if (cached) return cached;
      const index = await loadIndex();
      const shard = index.symbolIndex.find((entry) => entry.id === id)?.shard;
      if (!shard) throw new Error(`missing symbol ${id}`);
      const response = await fetch(asset(base, `assets/model/symbols/${shard}.json`));
      if (!response.ok) throw new Error(`missing symbol ${id}`);
      const page = (await response.json()) as SymbolPage;
      page.related = page.related ?? {};
      symbols.set(id, page);
      return page;
    },
    async source(path: string) {
      const cached = sources.get(path);
      if (cached) return cached;
      const index = await loadIndex();
      const shard = index.files.find((file) => file.fullName === path)?.sourceShard;
      if (!shard) throw new Error(`missing source ${path}`);
      const response = await fetch(asset(base, `assets/model/source/${shard}.json`));
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
      const response = await fetch(asset(base, "assets/model/references.json"));
      if (!response.ok) throw new Error("missing references");
      referencesCache = ((await response.json()) as SymbolReference[]) ?? [];
      return referencesCache;
    },
    async diff() {
      if (diffCache) return diffCache;
      const response = await fetch(asset(base, "assets/model/diff.json"));
      if (!response.ok) throw new Error("missing diff");
      diffCache = (await response.json()) as SchemaDiff;
      diffCache.added = diffCache.added ?? [];
      diffCache.removed = diffCache.removed ?? [];
      diffCache.modified = diffCache.modified ?? [];
      return diffCache;
    },
  };
}

export function asset(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base}${name}`;
}

