import { describe, expect, it } from "vitest";
import { highlightProto } from "./format.ts";

describe("highlightProto", () => {
  it("escapes markup in proto text before adding highlight spans", () => {
    const html = highlightProto(`message Nasty {\n  // <script>alert(1)</script> & "quotes"\n}`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("message");
  });
});
