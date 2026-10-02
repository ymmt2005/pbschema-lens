import { describe, expect, it } from "vitest";
import type { DocField, DocMessage, DocMethod, DocOneof, DocOption, DocService, SchemaDiff } from "../../../src/core/types.ts";
import { diffPageHtml, explorePageHtml, fieldTableHtml, graphPageHtml, messagePageHtml, methodPageHtml, servicePageHtml, type PageContext } from "./pages.ts";

const href = (path: string) => path;

const ctx: PageContext = {
  href,
  byId: new Map([
    ["svc", { id: "svc", name: "User", fullName: "acme.user.v1.User", urlPath: "/reference/services/acme.user.v1.User/", kind: "service", shard: "abc" }],
    ["msg", { id: "msg", name: "Account", fullName: "acme.user.v1.Account", urlPath: "/reference/messages/acme.user.v1.Account/", kind: "message", shard: "def" }],
  ]),
  packageByName: new Map([
    ["acme.user.v1", { fullName: "acme.user.v1", urlPath: "/reference/packages/acme.user.v1/", generatePage: true }],
  ]),
  fileByName: new Map([["user.proto", { fullName: "user.proto", urlPath: "/source/user.proto/", generatePage: true, hasSource: true }]]),
};

function field(partial: Partial<DocField> & Pick<DocField, "id" | "shortName" | "number">): DocField {
  return {
    kind: "field",
    fullName: partial.shortName,
    packageName: "acme.user.v1",
    fileName: "user.proto",
    domain: "local",
    generatePage: false,
    inNav: false,
    deprecated: false,
    options: [],
    references: [],
    referencedBy: [],
    urlPath: "/reference/messages/acme.user.v1.Account/",
    features: [],
    parentId: "msg",
    jsonName: partial.shortName,
    cardinality: "optional",
    type: { kind: "scalar", name: "string" },
    presence: "EXPLICIT",
    ...partial,
  };
}

describe("message pages", () => {
  it("renders the field table, options, features, and used-by sections from the previous site", () => {
    const oneof: DocOneof = {
      id: "oneof",
      kind: "oneof",
      fullName: "body",
      shortName: "body",
      packageName: "acme.user.v1",
      fileName: "user.proto",
      domain: "local",
      generatePage: false,
      inNav: false,
      deprecated: false,
      options: [],
      references: [],
      referencedBy: [],
      urlPath: "/reference/messages/acme.user.v1.Account/",
      anchor: "body",
      features: [],
      parentId: "msg",
      fieldIds: ["name"],
    };
    const name = field({
      id: "name",
      shortName: "name",
      number: 1,
      oneofId: "oneof",
      anchor: "name",
      options: [
        {
          name: "string",
          fullName: "buf.validate.field.string",
          extension: true,
          builtIn: false,
          target: "field",
          value: { kind: "message", typeName: "StringRules", fields: [], textProto: "" },
          textProto: "string: { min_len: 1 }",
          semantic: { rendererId: "validation", title: "Validate", summary: "min_len: 1", badges: ["min_len: 1"] },
        } satisfies DocOption,
      ],
    });
    const message = {
      id: "msg",
      kind: "message",
      fullName: "acme.user.v1.Account",
      shortName: "Account",
      packageName: "acme.user.v1",
      fileName: "user.proto",
      domain: "local",
      generatePage: true,
      inNav: false,
      deprecated: false,
      comments: { detached: [], markdownHtml: "<p>An account.</p>" },
      options: [
        {
          name: "deprecated",
          fullName: "deprecated",
          extension: false,
          builtIn: true,
          target: "message",
          value: { kind: "scalar", scalar: "bool", value: true },
          textProto: "deprecated = true",
        },
      ],
      references: [],
      referencedBy: [{ kind: "field-type", fromId: "svc", toId: "msg" }],
      urlPath: "/reference/messages/acme.user.v1.Account/",
      features: [{ name: "field_presence", effective: "EXPLICIT", source: "edition-default" }],
      fieldIds: ["name"],
      oneofIds: ["oneof"],
      nestedMessageIds: [],
      nestedEnumIds: [],
      nestedExtensionIds: [],
      extensionRanges: [],
      reservedRanges: [{ start: 10, end: 20 }],
      reservedNames: ["old"],
      mapEntry: false,
    } as DocMessage;
    const html = messagePageHtml(message, { name, oneof }, undefined, ctx);
    expect(html).toContain("kind-message");
    expect(html).toContain("validation-chip");
    expect(html).toContain("oneof-member");
    expect(html).toContain("At most one of");
    expect(html).not.toContain("deprecated = true");
    expect(html).toContain("Effective features");
    expect(html).toContain("default for this edition");
    expect(html).toContain("Field type");
    expect(html).toContain("10 to 19old");
    expect(html.indexOf(">Fields<")).toBeLessThan(html.indexOf("Effective features"));
    expect(html).toContain('href="/source/user.proto/"');
  });
});

describe("service and method pages", () => {
  const method = {
    id: "rpc",
    kind: "method",
    fullName: "acme.user.v1.User.Get",
    shortName: "Get",
    name: "Get",
    packageName: "acme.user.v1",
    fileName: "user.proto",
    domain: "local",
    generatePage: true,
    inNav: false,
    deprecated: false,
    options: [],
    references: [],
    referencedBy: [],
    urlPath: "/reference/methods/acme.user.v1.User.Get/",
    features: [],
    parentId: "svc",
    input: { kind: "message", name: "GetRequest", id: "req" },
    output: { kind: "message", name: "Account", id: "msg", urlPath: "/reference/messages/acme.user.v1.Account/" },
    clientStreaming: false,
    serverStreaming: true,
    streamingKind: "server_streaming",
    signature: "rpc Get",
  } as DocMethod;

  it("splits request and response columns and marks streaming", () => {
    const service = {
      id: "svc",
      kind: "service",
      fullName: "acme.user.v1.User",
      shortName: "User",
      packageName: "acme.user.v1",
      fileName: "user.proto",
      domain: "local",
      generatePage: true,
      inNav: true,
      deprecated: false,
      options: [],
      references: [],
      referencedBy: [],
      urlPath: "/reference/services/acme.user.v1.User/",
      features: [],
      methodIds: ["rpc"],
    } as DocService;
    const html = servicePageHtml(service, { rpc: method }, ctx);
    expect(html).toContain(">RPC<");
    expect(html).toContain(">Streaming<");
    expect(html).toContain("stream-chip");
    expect(html).not.toContain(">Mapping<");
  });

  it("prints the rpc signature and prefixes request field anchors", () => {
    const request = {
      id: "req",
      kind: "message",
      fieldIds: ["q"],
      oneofIds: [],
    } as DocMessage;
    const query = field({ id: "q", shortName: "query", number: 1, anchor: "query", parentId: "req" });
    const html = methodPageHtml(method, { req: request, q: query }, ctx);
    expect(html).toContain('class="proto"');
    expect(html).toContain("stream-keyword");
    expect(html).toContain('id="request-query"');
    expect(html).toContain("RPC on");
  });
});

describe("explore, graph, and diff", () => {
  it("uses the symbol picker, package cards, and colored diff counts", () => {
    expect(explorePageHtml([{ id: "msg", name: "Account", fullName: "acme.user.v1.Account", urlPath: "/m/", kind: "message", shard: "x" }])).toContain('id="symbol-select"');
    const graph = graphPageHtml(
      [
        { id: "a", fullName: "acme.user.v1", urlPath: "/p/", generatePage: true },
        { id: "b", fullName: "buf.validate", urlPath: "", generatePage: false },
      ],
      [{ from: "a", to: "wkt" }],
      href,
    );
    expect(graph).toContain("Imports:</span> wkt");
    expect(graph).not.toContain("buf.validate");
    const diff: SchemaDiff = {
      againstLabel: "previous",
      added: [{ id: "1", fullName: "acme.New", kind: "message", change: "added", details: ["created"] }],
      removed: [],
      modified: [],
      breaking: [],
    };
    const html = diffPageHtml(diff);
    expect(html).toContain("text-emerald-700");
    expect(html).toContain("text-emerald-800");
    expect(html).toContain("Compared against previous");
    expect(html).toContain(">None.<");
  });
});

describe("field tables", () => {
  it("uses the schema column group and an em dash when a field has no validation", () => {
    const html = fieldTableHtml([field({ id: "a", shortName: "id", number: 1, anchor: "id" })], [], href);
    expect(html).toContain("schema-fields");
    expect(html).toContain("col-validation");
    expect(html).toContain(">—<");
  });
});
