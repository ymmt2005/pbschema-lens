import type { SymbolIndexEntry, SymbolReference } from "../../src/core/types.ts";

export interface SiteIndex {
  symbolIndex: SymbolIndexEntry[];
}

// Only progressive controls use JSON. Page content, navigation, and metadata
// are already rendered by Go; there is no symbol/source/graph page loader.
export function createLoader(base: string) {
  let index: Promise<SiteIndex> | undefined;
  let comments: Promise<Record<string, string>> | undefined;
  let references: Promise<SymbolReference[]> | undefined;

  async function load<T>(name: string): Promise<T> {
    const response = await fetch(`${base}assets/model/${name}.json`);
    if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  return {
    index(): Promise<SiteIndex> {
      return index ??= load<SiteIndex>("index").catch(error => { index = undefined; throw error; });
    },
    comments(): Promise<Record<string, string>> {
      return comments ??= load<Record<string, string>>("comments").catch(error => { comments = undefined; throw error; });
    },
    references(): Promise<SymbolReference[]> {
      return references ??= load<SymbolReference[]>("references").catch(error => { references = undefined; throw error; });
    },
  };
}
