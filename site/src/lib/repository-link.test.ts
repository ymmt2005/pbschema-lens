import { describe, expect, it } from "vitest";
import { isExternalHref, repositoryLinkLabel } from "./repository-link.ts";

describe("repositoryLinkLabel", () => {
  it("names GitHub and GitLab from the host", () => {
    expect(repositoryLinkLabel("https://github.com/acme/apis/blob/main/a.proto#L1")).toBe("View on GitHub");
    expect(repositoryLinkLabel("https://gitlab.com/acme/apis/-/blob/main/a.proto#L1")).toBe("View on GitLab");
    expect(repositoryLinkLabel("https://src.example/a.proto")).toBe("View repository");
  });

  it("treats only http, https, and mailto as external hrefs", () => {
    expect(isExternalHref("https://github.com/acme/apis")).toBe(true);
    expect(isExternalHref("mailto:docs@example.com")).toBe(true);
    expect(isExternalHref("/source/a.proto/")).toBe(false);
  });
});
