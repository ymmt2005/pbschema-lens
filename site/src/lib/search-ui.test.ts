import { describe, expect, it } from "vitest";
import { incomingReferencesHtml, pagefindHitHtml, symbolHitHtml } from "./search-ui.ts";

describe("search result html", () => {
  it("escapes symbol names and pagefind excerpts", () => {
    const symbol = symbolHitHtml("message", `<img src=x onerror=alert(1)>`);
    expect(symbol).not.toContain("<img");
    expect(symbol).toContain("&lt;img");
    const page = pagefindHitHtml(`<script>alert(1)</script>`, `a <b>excerpt</b>`);
    expect(page).not.toContain("<script");
    expect(page).not.toContain("<b>");
  });

  it("escapes names in the used-by list", () => {
    const html = incomingReferencesHtml(
      `<tag>`,
      [{ fromId: "m", kind: "field-type" }],
      { m: `<img src=x onerror=alert(1)>` },
      { m: "/reference/messages/x/" },
      "/docs",
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<tag>");
    expect(html).toContain('href="/docs/reference/messages/x/"');
  });
});


describe("large incoming-reference lists", () => {
  it("offers expansion beyond 200 without losing the remaining references", () => {
    const refs = Array.from({length:205}, (_,i) => ({fromId:`reference-${i}`,kind:"field-type"}));
    const initial = incomingReferencesHtml("User",refs,{}, {}, "");
    expect(initial.match(/<li>/g)).toHaveLength(200);
    expect(initial).not.toContain("reference-200");
    expect(initial).toContain("Showing 200 of 205 references");
    expect(initial).toContain("data-more-references");
    const expanded = incomingReferencesHtml("User",refs,{}, {}, "",400);
    expect(expanded.match(/<li>/g)).toHaveLength(205);
    expect(expanded).toContain("reference-204");
    expect(expanded).not.toContain("data-more-references");
  });
});
