import { describe, expect, it } from "vitest";
import { compileInput } from "../node/compile.js";
import { loadRegistryFromBytes } from "./registry.js";
import { buildModel } from "./model.js";
import { fieldTableEntries } from "./field-table.js";

describe("fieldTableEntries", () => {
  it("groups oneof members under the oneof name instead of listing them as siblings", async () => {
    const dir = new URL("../../fixtures/cybozu-validate", import.meta.url).pathname;
    const compiled = await compileInput(dir);
    const registry = loadRegistryFromBytes(compiled.bytes);
    const model = buildModel(registry, {
      title: "test",
      inputLabel: dir,
      classification: {},
    });
    const profile = model.messages.find((item) => item.fullName === "fixtures.sample.Profile");
    expect(profile).toBeTruthy();
    const fields = profile!.fieldIds.map((id) => model.fields.find((item) => item.id === id)!).filter(Boolean);
    const oneofs = profile!.oneofIds.map((id) => model.oneofs.find((item) => item.id === id)!).filter(Boolean);
    const names = fieldTableEntries(fields, oneofs).map((entry) =>
      entry.kind === "oneof" ? { kind: "oneof", name: entry.oneof.shortName, members: entry.members.map((item) => item.shortName) } : { kind: "field", name: entry.field.shortName },
    );
    expect(names).toEqual([
      { kind: "field", name: "email" },
      { kind: "field", name: "age" },
      { kind: "field", name: "tags" },
      { kind: "oneof", name: "contact", members: ["phone", "uri"] },
    ]);
  });
});
