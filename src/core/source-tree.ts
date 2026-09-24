export interface SourceTreeFile {
  fullName: string;
  urlPath: string;
}

export interface SourceTreeNode {
  /** One path segment, such as `v1` or `user.proto`. */
  segment: string;
  /** Slash-separated path from the root. A file's path is its full name. */
  path: string;
  kind: "dir" | "file";
  /** Set when this path is a .proto file. A directory can also be a file. */
  file?: SourceTreeFile;
  children: SourceTreeNode[];
}

/**
 * Groups proto paths into directories and files.
 * `acme/user/v1/user.proto` and `acme/user/v1/user_service.proto` share `acme` → `user` → `v1`.
 * Directories sort before files. Everything starts folded; only ancestors of the open file expand.
 */
export function buildSourceTree(files: readonly SourceTreeFile[]): SourceTreeNode[] {
  const roots: SourceTreeNode[] = [];
  const byPath = new Map<string, SourceTreeNode>();

  for (const file of files) {
    const parts = file.fullName.split("/").filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    let siblings = roots;
    let path = "";
    for (let index = 0; index < parts.length; index++) {
      const segment = parts[index]!;
      path = path ? `${path}/${segment}` : segment;
      let node = byPath.get(path);
      if (!node) {
        node = { segment, path, kind: "dir", children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      if (index === parts.length - 1) {
        node.file = { fullName: file.fullName, urlPath: file.urlPath };
        if (node.children.length === 0) node.kind = "file";
      } else if (node.kind === "file") {
        node.kind = "dir";
      }
      siblings = node.children;
    }
  }

  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: SourceTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    if (a.segment < b.segment) return -1;
    if (a.segment > b.segment) return 1;
    return 0;
  });
  for (const node of nodes) sortNodes(node.children);
}

/** True when `active` is a file strictly inside this directory, so the directory should start expanded. */
export function sourceNodeOpen(path: string, active: string | undefined): boolean {
  if (!active) return false;
  return active.startsWith(`${path}/`);
}
