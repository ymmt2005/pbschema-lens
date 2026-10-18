import { describe, expect, it } from "vitest";
import { commentsToMarkdown, escapeHtml, renderSafeMarkdown } from "./markdown.js";
import { rankSymbol, searchSymbols } from "./search.js";
import { slug, symbolId } from "./ids.js";
import { urlPathFor, fileSourcePath, repositoryBlobUrl } from "./urls.js";
import type { SchemaModel } from "./types.js";

describe("markdown sanitization", () => {
  it("reflows soft breaks while preserving paragraphs, hard breaks, and code whitespace", () => {
    expect(renderSafeMarkdown("support\nworkflows").trim()).toBe("<p>support\nworkflows</p>");
    expect(renderSafeMarkdown("support\n\nworkflows").trim()).toBe("<p>support</p>\n<p>workflows</p>");
    for (const source of ["support  \nworkflows", "support\\\nworkflows"]) {
      expect(renderSafeMarkdown(source)).toMatch(/support<br\s*\/>\s*workflows/);
    }
    for (const source of ["```\nfirst\n  second\n```", "    first\n      second\n"]) {
      expect(renderSafeMarkdown(source)).toContain("<pre><code>first\n  second\n</code></pre>");
    }
  });

  it("places Markdown and raw HTML headings below the page title, capped at h6", () => {
    for (let level = 1; level <= 6; level++) {
      const target = Math.min(level + 1, 6);
      for (const source of ["#".repeat(level) + " Section", `<h${level} onclick="alert(1)">Section</h${level}>`]) {
        expect(renderSafeMarkdown(source).trim()).toBe(`<h${target}>Section</h${target}>`);
      }
    }
    expect(renderSafeMarkdown("Section\n=======").trim()).toBe("<h2>Section</h2>");
    expect(renderSafeMarkdown("<H1>Section</H1>").trim()).toBe("<h2>Section</h2>");
    expect(renderSafeMarkdown("`<h1>Title</h1>`")).toContain("&lt;h1&gt;Title&lt;/h1&gt;");
    expect(renderSafeMarkdown('```html\n<h1>Title</h1>\n```')).toContain("&lt;h1&gt;Title&lt;/h1&gt;");
    expect(renderSafeMarkdown('<a href="https://example.com" title="<h1>Title</h1>">link</a>')).toContain('title="&lt;h1&gt;Title&lt;/h1&gt;"');
  });

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

  it("preserves Markdown stars and relative indentation while removing known comment decoration", () => {
    for (const [source, expected] of [
      ["/**\n * line one\n * line two\n */", "line one\nline two"],
      ["/*\n```c\n* item\n```\n*/", "```c\n* item\n```"],
      [" * line one\n * line two\n", "* line one\n* line two"],
      [" **bold** intro\n", "**bold** intro"],
      ["*\n Intro\n\n * item\n", "Intro\n\n* item"],
      [" ```c\n *ptr = 1;\n   **nested = 2;\n ```\n", "```c\n*ptr = 1;\n  **nested = 2;\n```"],
      ["     *ptr = 1;\n       **nested = 2;\n", "    *ptr = 1;\n      **nested = 2;"],
    ]) expect(commentsToMarkdown([source])).toBe(expected);
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
