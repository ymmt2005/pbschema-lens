import { describe, expect, it } from "vitest";
import { builtinPlugins, isValidationRenderer, validationChips } from "./plugins.js";
import { compileInput } from "../node/compile.js";
import { loadRegistryFromBytes } from "./registry.js";
import { buildModel } from "./model.js";
import type { DocOption, DocSymbol } from "./types.js";

const renderers = builtinPlugins.flatMap((plugin) => plugin.semanticOptionRenderers ?? []);

function present(option: Pick<DocOption, "name" | "fullName" | "value" | "textProto">) {
  const doc = {
    extension: true,
    builtIn: false,
    target: "field",
    ...option,
  } as DocOption;
  const renderer = renderers.find((item) => item.matches(doc, {} as DocSymbol));
  return renderer?.render(doc, {} as DocSymbol);
}

describe("cybozu.validate renderer", () => {
  it("does not let buf.validate steal cybozu.validate options", () => {
    const semantic = present({
      name: "rules",
      fullName: "cybozu.validate.rules",
      textProto: "(cybozu.validate.rules).string.email = true",
      value: {
        kind: "message",
        typeName: "cybozu.validate.FieldRules",
        textProto: "",
        fields: [
          {
            name: "string",
            value: {
              kind: "message",
              typeName: "cybozu.validate.StringRules",
              textProto: "",
              fields: [{ name: "email", value: { kind: "scalar", scalar: "bool", value: true } }],
            },
          },
        ],
      },
    });
    expect(semantic?.rendererId).toBe("cybozu.validate");
    expect(semantic?.title).toBe("Cybozu validate");
    expect(semantic?.badges).toContain("string.email");
  });

  it("labels ignored messages and required oneofs", () => {
    expect(
      present({
        name: "ignored",
        fullName: "cybozu.validate.ignored",
        textProto: "(cybozu.validate.ignored) = true",
        value: { kind: "scalar", scalar: "bool", value: true },
      })?.badges,
    ).toEqual(["ignored"]);
    expect(
      present({
        name: "required",
        fullName: "cybozu.validate.required",
        textProto: "(cybozu.validate.required) = true",
        value: { kind: "scalar", scalar: "bool", value: true },
      })?.summary,
    ).toBe("Oneof must be set");
  });

  it("still renders buf.validate with the generic validation renderer", () => {
    const semantic = present({
      name: "field",
      fullName: "buf.validate.field",
      textProto: "(buf.validate.field).string.email = true",
      value: {
        kind: "message",
        typeName: "buf.validate.FieldConstraints",
        textProto: "",
        fields: [
          {
            name: "string",
            value: {
              kind: "message",
              typeName: "buf.validate.StringRules",
              textProto: "",
              fields: [{ name: "email", value: { kind: "scalar", scalar: "bool", value: true } }],
            },
          },
        ],
      },
    });
    expect(semantic?.rendererId).toBe("validation");
  });

  it("attaches cybozu.validate semantics when compiling a real schema", async () => {
    const dir = new URL("../../fixtures/cybozu-validate", import.meta.url).pathname;
    const compiled = await compileInput(dir);
    const registry = loadRegistryFromBytes(compiled.bytes);
    const model = buildModel(registry, {
      title: "test",
      inputLabel: dir,
      classification: {},
    });
    const ignored = model.messages.find((item) => item.fullName === "fixtures.sample.Ignored");
    expect(ignored?.options.some((option) => option.semantic?.rendererId === "cybozu.validate" && option.semantic.badges?.includes("ignored"))).toBe(true);
    const email = model.fields.find((item) => item.fullName === "fixtures.sample.Profile.email");
    const rules = email?.options.find((option) => option.fullName === "cybozu.validate.rules");
    expect(rules?.semantic?.rendererId).toBe("cybozu.validate");
    expect(rules?.semantic?.summary).toContain("email");
    expect(validationChips(email?.options ?? [])).toEqual(expect.arrayContaining(["string.email", "string.min_length=3"]));
    const contact = model.oneofs.find((item) => item.fullName === "fixtures.sample.Profile.contact");
    expect(contact?.options.some((option) => option.semantic?.badges?.includes("required"))).toBe(true);
  });

  it("exposes every constraint as a badge instead of truncating", () => {
    const fields = ["email", "uri", "uuid", "e164", "min_length", "max_length", "prefix", "suffix"].map((name) => ({
      name,
      value: {
        kind: "scalar" as const,
        scalar: name.endsWith("length") ? ("int32" as const) : ("bool" as const),
        value: name.endsWith("length") ? 3 : true,
      },
    }));
    const semantic = present({
      name: "field",
      fullName: "buf.validate.field",
      textProto: "",
      value: {
        kind: "message",
        typeName: "buf.validate.FieldConstraints",
        textProto: "",
        fields: [
          {
            name: "string",
            value: {
              kind: "message",
              typeName: "buf.validate.StringRules",
              textProto: "",
              fields,
            },
          },
        ],
      },
    });
    expect(semantic?.badges).toHaveLength(8);
    expect(semantic?.badges?.[0]).toBe("string.email");
    expect(semantic?.badges?.[7]).toBe("string.suffix");
  });

  it("collects validation chips and ignores other semantic badges", () => {
    expect(isValidationRenderer("validation")).toBe(true);
    expect(isValidationRenderer("cybozu.validate")).toBe(true);
    expect(isValidationRenderer("google.api.field_behavior")).toBe(false);
    const chips = validationChips([
      {
        name: "field_behavior",
        fullName: "google.api.field_behavior",
        extension: true,
        builtIn: false,
        target: "field",
        value: { kind: "enum", enumType: "google.api.FieldBehavior", name: "REQUIRED", number: 1 },
        textProto: "",
        semantic: { rendererId: "google.api.field_behavior", title: "Field behavior", summary: "REQUIRED", badges: ["REQUIRED"] },
      },
      {
        name: "field",
        fullName: "buf.validate.field",
        extension: true,
        builtIn: false,
        target: "field",
        value: { kind: "scalar", scalar: "bool", value: true },
        textProto: "",
        semantic: { rendererId: "validation", title: "Validation", summary: "string.email", badges: ["string.email", "string.min_len=1"] },
      },
    ]);
    expect(chips).toEqual(["string.email", "string.min_len=1"]);
  });
});
