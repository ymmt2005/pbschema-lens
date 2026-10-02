import { describe, expect, it } from "vitest";
import { buildPackageNavTree, homePackageAreas } from "../../../src/core/package-nav.ts";
import { areaCounts, homeAreasHtml, packageTreeHtml, sourceFilePageHtml, sourceIndexHtml, sourceTreeHtml } from "./trees.ts";
import { buildSourceTree } from "../../../src/core/source-tree.ts";

const href = (path: string) => path;

describe("packageTreeHtml", () => {
  const nodes = buildPackageNavTree([
    { fullName: "acme.user.v1", urlPath: "/reference/packages/acme.user.v1/" },
    { fullName: "acme.billing.v1", urlPath: "/reference/packages/acme.billing.v1/" },
    { fullName: "acme.security", urlPath: "/reference/packages/acme.security/" },
  ]);

  it("keeps folders closed until the active package is underneath", () => {
    const closed = packageTreeHtml(nodes, undefined, href);
    expect(closed).toContain('class="package-tree"');
    expect(closed).toContain("package-tree-chevron");
    expect(closed).toContain("<details");
    expect(closed).not.toContain(" open");
    expect(closed).toContain('class="package-tree-link package-tree-leaf"');

    const open = packageTreeHtml(nodes, "acme.user.v1", href);
    expect(open.match(/<details class="package-tree-node" open>/g)).toHaveLength(2);
    expect(open).toContain('class="package-tree-link is-active package-tree-leaf" href="/reference/packages/acme.user.v1/" aria-current="page"');
    const billing = open.slice(open.indexOf(">billing<"));
    expect(billing.startsWith(">billing<")).toBe(true);
    expect(billing.slice(0, 80)).not.toContain("open");
  });

  it("escapes package segments", () => {
    const html = packageTreeHtml(
      buildPackageNavTree([{ fullName: "acme.<script>", urlPath: "/reference/packages/x/" }]),
      undefined,
      href,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("homeAreasHtml", () => {
  it("renders collapsed area cards with singular counts and a leaf row", () => {
    expect(areaCounts({ packages: 1, services: 1, messages: 0 })).toBe("1 package · 1 service · 0 messages");
    const areas = homePackageAreas([
      { fullName: "acme.user.v1", urlPath: "/reference/packages/acme.user.v1/", services: 2, messages: 4 },
      { fullName: "acme.user.v2", urlPath: "/reference/packages/acme.user.v2/", services: 0, messages: 1 },
      { fullName: "acme.security", urlPath: "/reference/packages/acme.security/", services: 0, messages: 1 },
    ]);
    const html = homeAreasHtml(areas, href);
    expect(html).toContain('<details class="home-area">');
    expect(html).not.toContain('<details class="home-area" open');
    expect(html).toContain("home-area-counts");
    expect(html).toContain("1 package · 0 services · 1 message");
    expect(html).toContain('class="home-area home-area-leaf"');
    expect(html).toContain('class="package-tree"');
  });
});

describe("source trees", () => {
  const files = [
    { fullName: "acme/user/v1/user.proto", urlPath: "/source/acme/user/v1/user.proto/" },
    { fullName: "acme/billing/v1/invoice.proto", urlPath: "/source/acme/billing/v1/invoice.proto/" },
  ];

  it("folds the source index and opens only ancestors of the current file", () => {
    const index = sourceIndexHtml(files, href);
    expect(index).toContain("source-explorer is-index");
    expect(index).toContain("source-explorer-label");
    expect(index).toContain("Browse the embedded .proto files");
    expect(index).not.toContain(" open");
    expect(index).toContain("source-tree-icon-folder");

    const tree = sourceTreeHtml(buildSourceTree(files), "acme/user/v1/user.proto", href);
    expect(tree.match(/<details class="source-tree-node" open>/g)).toHaveLength(3);
    expect(tree).toContain('class="source-tree-file is-active"');
    expect(tree).toContain('aria-current="page"');
    expect(tree).toContain("source-tree-icon");
    const billing = tree.slice(tree.indexOf(">billing<"));
    expect(billing.startsWith(">billing<")).toBe(true);
    expect(billing.slice(billing.indexOf("<details"))).toMatch(/^<details class="source-tree-node">/);
  });

  it("shows the filename, directory crumb, and highlighted lines beside the tree", () => {
    const html = sourceFilePageHtml(
      {
        fullName: "acme/user/v1/user.proto",
        syntax: "proto3",
        packageName: "acme.user.v1",
        sourceText: 'syntax = "proto3";\n// <script>\n',
      },
      files,
      href,
    );
    expect(html).toContain("source-explorer is-split");
    expect(html).toContain("source-crumb");
    expect(html).toContain("<h1 class=\"text-2xl font-semibold mt-1 break-all\">user.proto</h1>");
    expect(html).toContain("proto3 · package acme.user.v1");
    expect(html).toContain('id="L1"');
    expect(html).toContain("text-[color:var(--accent)]");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("says when a descriptor-only build has no source", () => {
    expect(sourceIndexHtml([], href)).toContain("No source text was available");
  });
});
