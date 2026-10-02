import { describe, expect, it } from "vitest";
import type { DocField, DocOneof } from "./types.js";
import { fieldTableEntries } from "./field-table.js";

function field(name: string, oneofId?: string): DocField {
  return {
    id: `field:${name}`,
    kind: "field",
    fullName: `fixtures.sample.Profile.${name}`,
    shortName: name,
    packageName: "fixtures.sample",
    fileName: "sample.proto",
    domain: "local",
    generatePage: false,
    inNav: false,
    deprecated: false,
    options: [],
    references: [],
    referencedBy: [],
    urlPath: "/reference/messages/fixtures.sample.Profile/",
    features: [],
    parentId: "message:fixtures.sample.Profile",
    number: 1,
    jsonName: name,
    cardinality: "optional",
    type: { kind: "scalar", name: "string" },
    presence: "EXPLICIT",
    oneofId,
  };
}

describe("fieldTableEntries", () => {
  it("groups oneof members under the oneof name instead of listing them as siblings", () => {
    const oneof: DocOneof = {
      id: "oneof:contact",
      kind: "oneof",
      fullName: "fixtures.sample.Profile.contact",
      shortName: "contact",
      packageName: "fixtures.sample",
      fileName: "sample.proto",
      domain: "local",
      generatePage: false,
      inNav: false,
      deprecated: false,
      options: [],
      references: [],
      referencedBy: [],
      urlPath: "/reference/messages/fixtures.sample.Profile/",
      anchor: "oneof-contact",
      features: [],
      parentId: "message:fixtures.sample.Profile",
      fieldIds: ["field:phone", "field:uri"],
    };
    const names = fieldTableEntries(
      [field("email"), field("age"), field("tags"), field("phone", oneof.id), field("uri", oneof.id)],
      [oneof],
    ).map((entry) =>
      entry.kind === "oneof"
        ? { kind: "oneof" as const, name: entry.oneof.shortName, members: entry.members.map((item) => item.shortName) }
        : { kind: "field" as const, name: entry.field.shortName },
    );
    expect(names).toEqual([
      { kind: "field", name: "email" },
      { kind: "field", name: "age" },
      { kind: "field", name: "tags" },
      { kind: "oneof", name: "contact", members: ["phone", "uri"] },
    ]);
  });
});
