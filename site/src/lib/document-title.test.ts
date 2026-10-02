import { describe, expect, it } from "vitest";
import { documentTitle } from "./document-title.ts";

const pages = [
  { urlPath: "/reference/messages/acme.user.v1.User/", fullName: "acme.user.v1.User" },
  { urlPath: "/reference/messages/acme.user.v1.User/#email", fullName: "email" },
  { urlPath: "/source/acme/user/v1/user.proto/", fullName: "acme/user/v1/user.proto" },
];

describe("document titles", () => {
  it("uses the site title alone on the home page", () => {
    expect(documentTitle("/", "Acme Protobuf API", pages)).toBe("Acme Protobuf API");
    expect(documentTitle("", "Acme Protobuf API", pages)).toBe("Acme Protobuf API");
  });

  it("uses the symbol or file full name, and static titles for the other routes", () => {
    expect(documentTitle("/reference/messages/acme.user.v1.User/", "Acme", pages)).toBe("acme.user.v1.User · Acme");
    expect(documentTitle("/source/acme/user/v1/user.proto", "Acme", pages)).toBe("acme/user/v1/user.proto · Acme");
    expect(documentTitle("/explore/", "Acme", pages)).toBe("Used-by explorer · Acme");
    expect(documentTitle("/graph/", "Acme", pages)).toBe("Package graph · Acme");
    expect(documentTitle("/diff/", "Acme", pages)).toBe("Schema diff · Acme");
    expect(documentTitle("/source/", "Acme", pages)).toBe("Source · Acme");
  });

  it("titles an unknown path as not found", () => {
    expect(documentTitle("/missing/", "Acme", pages)).toBe("Not found · Acme");
  });
});
