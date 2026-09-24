import { describe, expect, it } from "vitest";
import { activePackageName, buildPackageNavTree, packageNodeOpen } from "./package-nav.js";

const items = [
  { fullName: "cybozu.admin.types", urlPath: "/reference/packages/cybozu.admin.types/" },
  { fullName: "cybozu.admin.flow", urlPath: "/reference/packages/cybozu.admin.flow/" },
  { fullName: "cybozu.admin.agent.coworker.v1beta1", urlPath: "/reference/packages/cybozu.admin.agent.coworker.v1beta1/" },
  { fullName: "acme.security", urlPath: "/reference/packages/acme.security/" },
  { fullName: "acme.billing.v1", urlPath: "/reference/packages/acme.billing.v1/" },
  { fullName: "cybozu.admin", urlPath: "/reference/packages/cybozu.admin/" },
];

describe("buildPackageNavTree", () => {
  it("nests dotted names and keeps a node that is also a package", () => {
    const tree = buildPackageNavTree(items);
    expect(tree.map((node) => node.segment)).toEqual(["acme", "cybozu"]);

    const acme = tree[0]!;
    expect(acme.item).toBeUndefined();
    expect(acme.children.map((node) => node.segment)).toEqual(["billing", "security"]);
    expect(acme.children[1]?.item?.fullName).toBe("acme.security");
    expect(acme.children[1]?.children).toEqual([]);
    expect(acme.children[0]?.children.map((node) => node.segment)).toEqual(["v1"]);
    expect(acme.children[0]?.children[0]?.item?.urlPath).toBe("/reference/packages/acme.billing.v1/");

    const admin = tree[1]?.children[0];
    expect(admin?.path).toBe("cybozu.admin");
    expect(admin?.item?.fullName).toBe("cybozu.admin");
    expect(admin?.children.map((node) => node.segment)).toEqual(["agent", "flow", "types"]);
    const agent = admin?.children[0];
    expect(agent?.item).toBeUndefined();
    expect(agent?.children[0]?.segment).toBe("coworker");
    expect(agent?.children[0]?.children[0]?.item?.fullName).toBe("cybozu.admin.agent.coworker.v1beta1");
  });
});

describe("activePackageName", () => {
  const names = items.map((item) => ({ fullName: item.fullName }));

  it("matches a package page and the longest prefix of a symbol page", () => {
    expect(activePackageName("/reference/packages/cybozu.admin.types/", names)).toBe("cybozu.admin.types");
    expect(activePackageName("/pbschema-lens/reference/messages/cybozu.admin.types.User/", names)).toBe(
      "cybozu.admin.types",
    );
    expect(activePackageName("/reference/services/cybozu.admin.AdminService/", names)).toBe("cybozu.admin");
    expect(activePackageName("/reference/enums/acme.billing.v1.InvoiceState/", names)).toBe("acme.billing.v1");
  });

  it("ignores pages outside the reference", () => {
    expect(activePackageName("/", names)).toBeUndefined();
    expect(activePackageName("/explore/", names)).toBeUndefined();
  });
});

describe("packageNodeOpen", () => {
  it("opens only ancestors of the active package", () => {
    expect(packageNodeOpen("cybozu", "cybozu.admin.types")).toBe(true);
    expect(packageNodeOpen("cybozu.admin", "cybozu.admin.types")).toBe(true);
    expect(packageNodeOpen("cybozu.admin.types", "cybozu.admin.types")).toBe(false);
    expect(packageNodeOpen("cybozu.admin.flow", "cybozu.admin.types")).toBe(false);
    expect(packageNodeOpen("cybozu", undefined)).toBe(false);
  });
});
