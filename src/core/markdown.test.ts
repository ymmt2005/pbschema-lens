import { describe, expect, it } from "vitest";
import { commentsToMarkdown, escapeHtml, renderSafeMarkdown } from "./markdown.js";
import { rankSymbol, searchSymbols } from "./search.js";
import { slug, symbolId } from "./ids.js";
import { urlPathFor, fileSourcePath, repositoryBlobUrl } from "./urls.js";
import { diffModels } from "./diff.js";
import type { SchemaModel, DocSymbol } from "./types.js";

describe("markdown sanitization", () => {
  it("strips script tags and event handlers", () => {
    const html = renderSafeMarkdown(`Hello <script>alert("xss")</script> **world** <img src=x onerror="alert(1)">`);
    expect(html).toContain("world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert");
  });

  it("does not evaluate MDX expressions", () => {
    const html = renderSafeMarkdown("Value {2 * 2} stays literal");
    expect(html).toContain("{2 * 2}");
  });

  it("allows a safe HTML subset used by googleapis comments", () => {
    const html = renderSafeMarkdown(`<p>See the <b>User</b> message.</p>`);
    expect(html).toContain("<b>User</b>");
  });

  it("escapes HTML entities", () => {
    expect(escapeHtml(`<foo & "bar">`)).toBe("&lt;foo &amp; &quot;bar&quot;&gt;");
  });

  it("normalizes proto comment stars", () => {
    expect(commentsToMarkdown([" * line one\n * line two"])).toContain("line one");
  });

  it("drops links whose scheme is outside http, https, and mailto", () => {
    const html = renderSafeMarkdown(
      `[js](javascript:alert(1)) [data](data:text/html,<script>alert(1)</script>) [ok](https://example.com/docs)`,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html).toContain('href="https://example.com/docs"');
  });

  it("discards tags outside the allowlist", () => {
    const html = renderSafeMarkdown(`<iframe src="https://evil.example"></iframe><svg><script>alert(1)</script></svg><style>body{}</style><img src=x>`);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("strips event handlers on allowed tags and sets noopener on links", () => {
    const html = renderSafeMarkdown(`<a href="https://example.com" onclick="alert(1)" target="_blank">docs</a>`);
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("alert");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">docs</a>");
  });
});

describe("identity and URLs", () => {
  it("builds stable symbol ids", () => {
    expect(symbolId("message", "acme.user.v1.User")).toBe("message:acme.user.v1.User");
  });

  it("uses a consistent URL grammar", () => {
    expect(urlPathFor("message", "google.protobuf.Timestamp").urlPath).toBe(
      "/reference/messages/google.protobuf.Timestamp/",
    );
    expect(urlPathFor("field", "acme.user.v1.User.email", "acme.user.v1.User").anchor).toBe("email");
    expect(urlPathFor("method", "acme.user.v1.UserService.GetUser", "acme.user.v1.UserService")).toEqual({
      urlPath: "/reference/methods/acme.user.v1.UserService.GetUser/",
    });
  });

  it("builds in-site source paths with line anchors", () => {
    expect(fileSourcePath("acme/user/v1/user.proto", 36)).toBe("/source/acme/user/v1/user.proto/#L36");
  });

  it("only builds repository blob URLs for GitHub and GitLab", () => {
    expect(
      repositoryBlobUrl({ repository: "github:acme/apis", commit: "abc" }, "user.proto", 3),
    ).toBe("https://github.com/acme/apis/blob/abc/user.proto#L3");
    expect(repositoryBlobUrl({ repository: "https://origin.example/git/repo.git" }, "user.proto", 3)).toBeUndefined();
  });

  it("slugs mixed-case names", () => {
    expect(slug("GetUser")).toBe("get-user");
  });
});

describe("search ranking", () => {
  const model = {
    symbolIndex: [
      { id: "message:acme.user.v1.User", name: "User", fullName: "acme.user.v1.User", kind: "message", package: "acme.user.v1", urlPath: "/reference/messages/acme.user.v1.User/" },
      { id: "method:acme.user.v1.UserService.GetUser", name: "GetUser", fullName: "acme.user.v1.UserService.GetUser", kind: "method", package: "acme.user.v1", urlPath: "/x" },
    ],
  } as SchemaModel;

  it("prefers exact fully qualified names", () => {
    const hits = searchSymbols(model, "acme.user.v1.User");
    expect(hits[0]?.entry.fullName).toBe("acme.user.v1.User");
    expect(hits[0]?.reason).toContain("exact fully qualified");
  });

  it("ranks prefix above substring above a fuzzy name", () => {
    const prefix = searchSymbols(model, "acme.user");
    expect(prefix[0]?.reason).toBe("prefix match");
    const substring = searchSymbols(model, "UserService");
    expect(substring.map((hit) => hit.entry.name)).toEqual(["GetUser"]);
    expect(substring[0]?.reason).toBe("substring match");
    const fuzzy = searchSymbols(model, "GtUr");
    expect(fuzzy.map((hit) => hit.entry.name)).toEqual(["GetUser"]);
    expect(fuzzy[0]?.reason).toBe("symbol-name fuzzy match");
    expect(rankSymbol(model.symbolIndex[1]!, "GtUr")).toBe(fuzzy[0]?.score);
  });
});

describe("diff", () => {
  function stub(id: string, kind: DocSymbol["kind"], extra: Partial<SchemaModel> = {}): SchemaModel {
    const symbol = {
      id,
      kind,
      fullName: id.split(":")[1] ?? id,
      shortName: "X",
      packageName: "p",
      fileName: "x.proto",
      domain: "local",
      generatePage: true,
      inNav: true,
      deprecated: false,
      options: [],
      references: [],
      referencedBy: [],
      urlPath: "/",
      features: [],
    } as DocSymbol;
    return {
      title: "t",
      packages: [],
      files: [],
      messages: [],
      fields: [],
      oneofs: [],
      enums: [],
      enumValues: [],
      services: [],
      methods: [],
      extensions: [],
      symbols: { [id]: symbol },
      byFullName: {},
      symbolIndex: [],
      buildInfo: {
        title: "t",
        generatedAt: "",
        generator: "pbschema-lens",
        input: ".",
        symbolCount: 1,
        fileCount: 1,
        timings: {},
        warnings: [],
      },
      wktNotes: {},
      ...extra,
    };
  }

  it("detects added and removed symbols", () => {
    const prev = stub("message:A", "message");
    const next = stub("message:B", "message");
    const diff = diffModels(next, prev, "old");
    expect(diff.added[0]?.id).toBe("message:B");
    expect(diff.removed[0]?.id).toBe("message:A");
  });
});
