export interface PackageNavItem {
  fullName: string;
  urlPath: string;
}

export interface PackageNavNode {
  /** One dotted segment, such as `admin`. */
  segment: string;
  /** Dotted path from the root, such as `cybozu.admin`. */
  path: string;
  /** Set when this node is itself a documented package. */
  item?: PackageNavItem;
  children: PackageNavNode[];
}

/**
 * Groups package names by dotted segments.
 * `cybozu.admin.types` and `cybozu.admin.flow` share `cybozu` → `admin`.
 * A node can be both a package and a parent (`acme.security` next to `acme.user.v1`).
 */
export function buildPackageNavTree(items: readonly PackageNavItem[]): PackageNavNode[] {
  const roots: PackageNavNode[] = [];
  const byPath = new Map<string, PackageNavNode>();

  for (const item of items) {
    const parts = item.fullName.split(".").filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    let siblings = roots;
    let path = "";
    for (let index = 0; index < parts.length; index++) {
      const segment = parts[index]!;
      path = path ? `${path}.${segment}` : segment;
      let node = byPath.get(path);
      if (!node) {
        node = { segment, path, children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      if (index === parts.length - 1) {
        node.item = { fullName: item.fullName, urlPath: item.urlPath };
      }
      siblings = node.children;
    }
  }

  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: PackageNavNode[]): void {
  nodes.sort((a, b) => a.segment.localeCompare(b.segment, undefined, { numeric: true }));
  for (const node of nodes) sortNodes(node.children);
}

/**
 * Package full name for the current reference page, if any.
 * Message, enum, service, and extension pages match the longest package prefix.
 */
export function activePackageName(
  pathname: string,
  items: readonly { fullName: string }[],
): string | undefined {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const match = decoded.match(/\/reference\/(?:packages|messages|enums|services|extensions)\/([^/#?]+)/);
  const symbol = match?.[1];
  if (!symbol) return undefined;
  let best: string | undefined;
  for (const item of items) {
    if (symbol === item.fullName || symbol.startsWith(`${item.fullName}.`)) {
      if (!best || item.fullName.length > best.length) best = item.fullName;
    }
  }
  return best;
}

/** True when `active` is a package strictly under this node, so the node should start expanded. */
export function packageNodeOpen(path: string, active: string | undefined): boolean {
  if (!active) return false;
  return active.startsWith(`${path}.`);
}

export interface PackageAreaPackage extends PackageNavItem {
  services: number;
  messages: number;
}

export interface PackageAreaCounts {
  packages: number;
  services: number;
  messages: number;
}

export interface PackageAreaRow {
  /** Segment shown on the row, such as `admin`. Empty when the row covers many top-level roots. */
  label: string;
  /** Dotted path of the node this row represents. */
  path: string;
  /** Set when this row's node is itself a documented package. */
  urlPath?: string;
  counts: PackageAreaCounts;
  /** Child nodes revealed when the row is expanded. Empty for a leaf package. */
  nodes: PackageNavNode[];
}

/**
 * Home page lists at most this many area rows.
 * A wider branch collapses into one parent row so dozens of packages stay one line.
 */
export const HOME_PACKAGE_AREA_LIMIT = 12;

/**
 * Summary rows for the home page.
 * A single-child prefix is skipped (`cybozu` → `admin` → … starts at the first real branch).
 * That branch's children become the rows. More than `maxRows` children collapse into the parent.
 */
export function homePackageAreas(
  items: readonly PackageAreaPackage[],
  maxRows: number = HOME_PACKAGE_AREA_LIMIT,
): PackageAreaRow[] {
  const tree = buildPackageNavTree(items);
  const stats = new Map(items.map((item) => [item.fullName, { services: item.services, messages: item.messages }]));
  if (tree.length === 0) return [];
  if (tree.length === 1) return rowsForBranch(tree[0]!, stats, maxRows);
  if (tree.length > maxRows) {
    return [
      {
        label: "",
        path: "",
        counts: sumCounts(tree.map((node) => rollup(node, stats))),
        nodes: tree,
      },
    ];
  }
  return tree.map((node) => rowFor(node, stats));
}

function rowsForBranch(
  node: PackageNavNode,
  stats: Map<string, { services: number; messages: number }>,
  maxRows: number,
): PackageAreaRow[] {
  let current = node;
  while (current.children.length === 1) current = current.children[0]!;
  if (current.children.length === 0 || current.children.length > maxRows) return [rowFor(current, stats)];
  return current.children.map((child) => rowFor(child, stats));
}

function rowFor(
  node: PackageNavNode,
  stats: Map<string, { services: number; messages: number }>,
): PackageAreaRow {
  return {
    label: node.segment,
    path: node.path,
    urlPath: node.item?.urlPath,
    counts: rollup(node, stats),
    nodes: node.children,
  };
}

function rollup(
  node: PackageNavNode,
  stats: Map<string, { services: number; messages: number }>,
): PackageAreaCounts {
  const own = stats.get(node.path);
  const counts: PackageAreaCounts = {
    packages: own ? 1 : 0,
    services: own?.services ?? 0,
    messages: own?.messages ?? 0,
  };
  for (const child of node.children) {
    const nested = rollup(child, stats);
    counts.packages += nested.packages;
    counts.services += nested.services;
    counts.messages += nested.messages;
  }
  return counts;
}

function sumCounts(counts: PackageAreaCounts[]): PackageAreaCounts {
  return counts.reduce(
    (total, item) => ({
      packages: total.packages + item.packages,
      services: total.services + item.services,
      messages: total.messages + item.messages,
    }),
    { packages: 0, services: 0, messages: 0 },
  );
}
