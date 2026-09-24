import { describe, expect, it } from "vitest";
import { activePackageName, buildPackageNavTree, homePackageAreas, packageNodeOpen } from "./package-nav.js";

function area(fullName: string, services: number, messages: number) {
  return { fullName, urlPath: `/reference/packages/${fullName}/`, services, messages };
}

const items = [
  { fullName: "example.admin.types", urlPath: "/reference/packages/example.admin.types/" },
  { fullName: "example.admin.flow", urlPath: "/reference/packages/example.admin.flow/" },
  { fullName: "example.admin.agent.coworker.v1beta1", urlPath: "/reference/packages/example.admin.agent.coworker.v1beta1/" },
  { fullName: "acme.security", urlPath: "/reference/packages/acme.security/" },
  { fullName: "acme.billing.v1", urlPath: "/reference/packages/acme.billing.v1/" },
  { fullName: "example.admin", urlPath: "/reference/packages/example.admin/" },
];

describe("buildPackageNavTree", () => {
  it("nests dotted names and keeps a node that is also a package", () => {
    const tree = buildPackageNavTree(items);
    expect(tree.map((node) => node.segment)).toEqual(["acme", "example"]);

    const acme = tree[0]!;
    expect(acme.item).toBeUndefined();
    expect(acme.children.map((node) => node.segment)).toEqual(["billing", "security"]);
    expect(acme.children[1]?.item?.fullName).toBe("acme.security");
    expect(acme.children[1]?.children).toEqual([]);
    expect(acme.children[0]?.children.map((node) => node.segment)).toEqual(["v1"]);
    expect(acme.children[0]?.children[0]?.item?.urlPath).toBe("/reference/packages/acme.billing.v1/");

    const admin = tree[1]?.children[0];
    expect(admin?.path).toBe("example.admin");
    expect(admin?.item?.fullName).toBe("example.admin");
    expect(admin?.children.map((node) => node.segment)).toEqual(["agent", "flow", "types"]);
    const agent = admin?.children[0];
    expect(agent?.item).toBeUndefined();
    expect(agent?.children[0]?.segment).toBe("coworker");
    expect(agent?.children[0]?.children[0]?.item?.fullName).toBe("example.admin.agent.coworker.v1beta1");
  });
});

describe("activePackageName", () => {
  const names = items.map((item) => ({ fullName: item.fullName }));

  it("matches a package page and the longest prefix of a symbol page", () => {
    expect(activePackageName("/reference/packages/example.admin.types/", names)).toBe("example.admin.types");
    expect(activePackageName("/pbschema-lens/reference/messages/example.admin.types.User/", names)).toBe(
      "example.admin.types",
    );
    expect(activePackageName("/reference/services/example.admin.AdminService/", names)).toBe("example.admin");
    expect(activePackageName("/reference/enums/acme.billing.v1.InvoiceState/", names)).toBe("acme.billing.v1");
  });

  it("ignores pages outside the reference", () => {
    expect(activePackageName("/", names)).toBeUndefined();
    expect(activePackageName("/explore/", names)).toBeUndefined();
  });
});

describe("homePackageAreas", () => {
  it("skips a unary prefix and lists the first branch", () => {
    const rows = homePackageAreas([
      area("example.admin.types", 0, 2),
      area("example.admin.flow", 1, 3),
      area("example.admin.agent.coworker.v1beta1", 1, 4),
    ]);
    expect(rows.map((row) => row.label)).toEqual(["agent", "flow", "types"]);
    expect(rows.find((row) => row.label === "types")).toMatchObject({
      urlPath: "/reference/packages/example.admin.types/",
      counts: { packages: 1, services: 0, messages: 2 },
      nodes: [],
    });
    const agent = rows.find((row) => row.label === "agent");
    expect(agent?.urlPath).toBeUndefined();
    expect(agent?.counts).toEqual({ packages: 1, services: 1, messages: 4 });
    expect(agent?.nodes.map((node) => node.segment)).toEqual(["coworker"]);
  });

  it("lists each child of a small top-level branch", () => {
    const rows = homePackageAreas([
      area("acme.billing.v1", 1, 6),
      area("acme.experiment.v1", 0, 2),
      area("acme.security", 0, 1),
      area("acme.user.v1", 1, 8),
    ]);
    expect(rows.map((row) => row.label)).toEqual(["billing", "experiment", "security", "user"]);
    expect(rows.find((row) => row.label === "security")?.urlPath).toBe("/reference/packages/acme.security/");
    expect(rows.find((row) => row.label === "billing")?.nodes.map((node) => node.segment)).toEqual(["v1"]);
    expect(rows.find((row) => row.label === "billing")?.counts).toEqual({ packages: 1, services: 1, messages: 6 });
  });

  it("collapses a wide branch into the parent row", () => {
    const rows = homePackageAreas([
      area("example.admin", 2, 1),
      ...Array.from({ length: 13 }, (_, index) => area(`example.admin.svc${index}`, 1, 0)),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "admin",
      urlPath: "/reference/packages/example.admin/",
      counts: { packages: 14, services: 15, messages: 1 },
    });
    expect(rows[0]?.nodes).toHaveLength(13);
  });

  it("keeps a handful of roots as separate rows and collapses many roots", () => {
    const two = homePackageAreas([area("acme.billing.v1", 1, 1), area("example.admin.types", 0, 1)]);
    expect(two.map((row) => row.label)).toEqual(["acme", "example"]);

    const many = homePackageAreas(Array.from({ length: 13 }, (_, index) => area(`area${index}`, 0, 1)));
    expect(many).toHaveLength(1);
    expect(many[0]?.label).toBe("");
    expect(many[0]?.counts).toEqual({ packages: 13, services: 0, messages: 13 });
    expect(many[0]?.nodes).toHaveLength(13);
  });

  it("returns one leaf for a single package after skipping its prefix", () => {
    expect(homePackageAreas([area("acme.security", 0, 1)])).toEqual([
      {
        label: "security",
        path: "acme.security",
        urlPath: "/reference/packages/acme.security/",
        counts: { packages: 1, services: 0, messages: 1 },
        nodes: [],
      },
    ]);
  });
});

describe("packageNodeOpen", () => {
  it("opens only ancestors of the active package", () => {
    expect(packageNodeOpen("example", "example.admin.types")).toBe(true);
    expect(packageNodeOpen("example.admin", "example.admin.types")).toBe(true);
    expect(packageNodeOpen("example.admin.types", "example.admin.types")).toBe(false);
    expect(packageNodeOpen("example.admin.flow", "example.admin.types")).toBe(false);
    expect(packageNodeOpen("example", undefined)).toBe(false);
  });
});
