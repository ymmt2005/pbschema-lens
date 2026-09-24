import { describe, expect, it } from "vitest";
import { buildSourceTree, sourceNodeOpen } from "./source-tree.js";

const files = [
  { fullName: "acme/user/v1/user.proto", urlPath: "/source/acme/user/v1/user.proto/" },
  { fullName: "acme/user/v1/user_service.proto", urlPath: "/source/acme/user/v1/user_service.proto/" },
  { fullName: "acme/billing/v1/invoice.proto", urlPath: "/source/acme/billing/v1/invoice.proto/" },
  { fullName: "google/api/http.proto", urlPath: "/source/google/api/http.proto/" },
  { fullName: "options.proto", urlPath: "/source/options.proto/" },
];

describe("buildSourceTree", () => {
  it("nests slash paths and lists directories before files", () => {
    const tree = buildSourceTree(files);
    expect(tree.map((node) => node.segment)).toEqual(["acme", "google", "options.proto"]);
    expect(tree[2]?.kind).toBe("file");
    expect(tree[2]?.file?.urlPath).toBe("/source/options.proto/");

    const acme = tree[0]!;
    expect(acme.kind).toBe("dir");
    expect(acme.path).toBe("acme");
    expect(acme.children.map((node) => node.segment)).toEqual(["billing", "user"]);

    const v1 = acme.children[1]?.children[0];
    expect(v1?.path).toBe("acme/user/v1");
    expect(v1?.children.map((node) => node.segment)).toEqual(["user.proto", "user_service.proto"]);
    expect(v1?.children[0]?.kind).toBe("file");
    expect(v1?.children[0]?.file?.fullName).toBe("acme/user/v1/user.proto");
  });

  it("keeps a file that is also a directory prefix", () => {
    const tree = buildSourceTree([
      { fullName: "acme", urlPath: "/source/acme/" },
      { fullName: "acme/user.proto", urlPath: "/source/acme/user.proto/" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.kind).toBe("dir");
    expect(tree[0]?.file?.fullName).toBe("acme");
    expect(tree[0]?.children.map((node) => node.segment)).toEqual(["user.proto"]);
  });
});

describe("sourceNodeOpen", () => {
  it("opens only ancestors of the current file", () => {
    expect(sourceNodeOpen("acme", "acme/user/v1/user.proto")).toBe(true);
    expect(sourceNodeOpen("acme/user", "acme/user/v1/user.proto")).toBe(true);
    expect(sourceNodeOpen("acme/user/v1", "acme/user/v1/user.proto")).toBe(true);
    expect(sourceNodeOpen("acme/user/v1/user.proto", "acme/user/v1/user.proto")).toBe(false);
    expect(sourceNodeOpen("acme/billing", "acme/user/v1/user.proto")).toBe(false);
    expect(sourceNodeOpen("acme", undefined)).toBe(false);
  });
});
