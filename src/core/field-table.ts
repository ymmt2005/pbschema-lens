import type { DocField, DocOneof } from "./types.js";

export type FieldTableEntry =
  | { kind: "field"; field: DocField }
  | { kind: "oneof"; oneof: DocOneof; members: DocField[] };

/** Group oneof members under the oneof at the first member’s position. */
export function fieldTableEntries(fields: DocField[], oneofs: DocOneof[]): FieldTableEntry[] {
  const oneofById = new Map(oneofs.map((item) => [item.id, item]));
  const fieldById = new Map(fields.map((item) => [item.id, item]));
  const emitted = new Set<string>();
  const entries: FieldTableEntry[] = [];

  for (const field of fields) {
    if (emitted.has(field.id)) {
      continue;
    }
    const oneof = field.oneofId ? oneofById.get(field.oneofId) : undefined;
    if (!oneof) {
      entries.push({ kind: "field", field });
      continue;
    }
    const members = oneof.fieldIds
      .map((id) => fieldById.get(id))
      .filter((item): item is DocField => Boolean(item));
    for (const member of members) {
      emitted.add(member.id);
    }
    entries.push({ kind: "oneof", oneof, members });
  }
  return entries;
}
