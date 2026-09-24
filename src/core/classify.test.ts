import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyFile, resolveExternalUrl } from "./classify.js";
import { documentationClassification, loadConfig } from "../node/config.js";

const yaml = `documentation:
  include:
    - "acme/user/**"
  exclude:
    - "google/api/**"
    - "buf/validate/**"
    - "cybozu/validate/**"
wellKnownTypes:
  enabled: false
externalLinks:
  - package: "acme.billing.v1.**"
    urlTemplate: "https://docs.example.com/billing/{symbol}"
`;

describe("classifyFile", () => {
  it("reads include, exclude, external links, and well-known types from yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pbschema-lens-classify-"));
    await writeFile(join(dir, "pbschema-lens.yaml"), yaml);
    const classification = documentationClassification(loadConfig(dir).config);

    expect(classifyFile("acme/user/v1/user.proto", "acme.user.v1", classification)).toMatchObject({
      domain: "local",
      generatePage: true,
      inNav: true,
    });
    expect(classifyFile("acme/experiment/v1/flags.proto", "acme.experiment.v1", classification)).toMatchObject({
      domain: "external-undocumented",
      generatePage: false,
      inNav: false,
    });
    expect(classifyFile("google/api/http.proto", "google.api", classification)).toMatchObject({
      domain: "external-undocumented",
      generatePage: false,
      inNav: false,
    });
    expect(classifyFile("acme/billing/v1/invoice.proto", "acme.billing.v1", classification)).toMatchObject({
      domain: "external-documented",
      generatePage: false,
      inNav: false,
    });
    expect(resolveExternalUrl("acme.billing.v1.Invoice", "message", classification)).toBe(
      "https://docs.example.com/billing/acme.billing.v1.Invoice",
    );
    expect(classifyFile("google/protobuf/timestamp.proto", "google.protobuf", classification)).toEqual({
      domain: "well-known",
      generatePage: false,
      inNav: false,
    });

    const shown = documentationClassification({
      ...loadConfig(dir).config,
      wellKnownTypes: undefined,
    });
    expect(shown.wellKnownTypes).toBe(true);
    expect(classifyFile("google/protobuf/timestamp.proto", "google.protobuf", shown).generatePage).toBe(true);
    expect(classifyFile("google/protobuf/descriptor.proto", "google.protobuf", shown)).toMatchObject({
      domain: "well-known",
      generatePage: false,
      inNav: false,
    });
  });
});
