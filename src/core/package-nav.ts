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
