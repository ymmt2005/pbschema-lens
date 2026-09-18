import type { DocOption, PbSchemaLensPlugin, SemanticPresentation, SemanticOptionRenderer } from "./types.js";

const httpRenderer: SemanticOptionRenderer = {
  id: "google.api.http",
  matches(option) {
    return option.fullName === "google.api.http" || option.name === "http";
  },
  render(option): SemanticPresentation {
    const methods = flattenHttp(option);
    return {
      rendererId: "google.api.http",
      title: "HTTP",
      summary: methods.join(" · ") || "HTTP mapping",
      badges: methods.length ? methods.map((item) => item.split(" ")[0] ?? "HTTP") : ["HTTP"],
      details: option.textProto,
    };
  },
};

const cybozuValidateRenderer: SemanticOptionRenderer = {
  id: "cybozu.validate",
  matches(option) {
    return option.fullName === "cybozu.validate.rules"
      || option.fullName === "cybozu.validate.ignored"
      || option.fullName === "cybozu.validate.required"
      || option.fullName.startsWith("cybozu.validate.");
  },
  render(option): SemanticPresentation {
    if (option.fullName === "cybozu.validate.ignored") {
      return {
        rendererId: "cybozu.validate",
        title: "Cybozu validate",
        summary: "Skip generated Validate() for this message",
        badges: ["ignored"],
        details: option.textProto,
      };
    }
    if (option.fullName === "cybozu.validate.required") {
      return {
        rendererId: "cybozu.validate",
        title: "Cybozu validate",
        summary: "Oneof must be set",
        badges: ["required"],
        details: option.textProto,
      };
    }
    const constraints = collectConstraints(option);
    return {
      rendererId: "cybozu.validate",
      title: "Cybozu validate",
      summary: constraints.join(", ") || "Normalization and validation rules",
      badges: constraints,
      details: option.textProto,
    };
  },
};

const validationRenderer: SemanticOptionRenderer = {
  id: "validation",
  matches(option) {
    return option.fullName.startsWith("buf.validate.") || option.fullName.startsWith("validate.");
  },
  render(option): SemanticPresentation {
    const constraints = collectConstraints(option);
    return {
      rendererId: "validation",
      title: "Validation",
      summary: constraints.join(", ") || "Validation constraints",
      badges: constraints,
      details: option.textProto,
    };
  },
};

const deprecatedRenderer: SemanticOptionRenderer = {
  id: "deprecated",
  matches(option) {
    return option.name === "deprecated" && option.value.kind === "scalar" && option.value.value === true;
  },
  render(): SemanticPresentation {
    return {
      rendererId: "deprecated",
      title: "Deprecated",
      summary: "This declaration is deprecated and should not be used in new code.",
      badges: ["deprecated"],
    };
  },
};

const fieldBehaviorRenderer: SemanticOptionRenderer = {
  id: "google.api.field_behavior",
  matches(option) {
    return option.fullName === "google.api.field_behavior" || option.name === "field_behavior";
  },
  render(option): SemanticPresentation {
    const values = listEnumNames(option);
    return {
      rendererId: "google.api.field_behavior",
      title: "Field behavior",
      summary: values.join(", ") || "Field behavior",
      badges: values,
    };
  },
};

export const builtinPlugins: PbSchemaLensPlugin[] = [
  {
    name: "builtin",
    semanticOptionRenderers: [httpRenderer, cybozuValidateRenderer, validationRenderer, fieldBehaviorRenderer, deprecatedRenderer],
  },
];

const VALIDATION_RENDERER_IDS = new Set(["validation", "cybozu.validate"]);

export function isValidationRenderer(rendererId: string | undefined): boolean {
  return rendererId !== undefined && VALIDATION_RENDERER_IDS.has(rendererId);
}

/** Constraint chips for the field-table Validation column. */
export function validationChips(options: DocOption[]): string[] {
  const chips: string[] = [];
  for (const option of options) {
    const semantic = option.semantic;
    if (!isValidationRenderer(semantic?.rendererId)) {
      continue;
    }
    if (semantic?.badges?.length) {
      chips.push(...semantic.badges);
    } else if (semantic?.summary) {
      chips.push(semantic.summary);
    }
  }
  return chips;
}

function flattenHttp(option: DocOption): string[] {
  const value = option.value;
  if (value.kind !== "message") {
    return [];
  }
  const methods: string[] = [];
  const verbs = ["get", "put", "post", "delete", "patch"];
  for (const field of value.fields) {
    if (verbs.includes(field.name) && field.value.kind === "scalar") {
      methods.push(`${field.name.toUpperCase()} ${String(field.value.value)}`);
    }
    if (field.name === "custom" && field.value.kind === "message") {
      const kind = field.value.fields.find((item) => item.name === "kind");
      const path = field.value.fields.find((item) => item.name === "path");
      if (kind?.value.kind === "scalar" && path?.value.kind === "scalar") {
        methods.push(`${String(kind.value.value)} ${String(path.value.value)}`);
      }
    }
    if (field.name === "additional_bindings" && field.value.kind === "list") {
      for (const item of field.value.values) {
        if (item.kind === "message") {
          methods.push(...flattenHttp({ ...option, value: item }));
        }
      }
    }
    if (field.name === "body" && field.value.kind === "scalar") {
      methods.push(`body=${String(field.value.value)}`);
    }
  }
  return methods;
}

function collectConstraints(option: DocOption): string[] {
  const out: string[] = [];
  walk(option.value, [], out);
  return out;
}

function walk(value: DocOption["value"], path: string[], out: string[]): void {
  switch (value.kind) {
    case "scalar":
      if (typeof value.value === "boolean" && value.value && path.length) {
        out.push(path.join("."));
      } else if (path.length && value.value !== false) {
        out.push(`${path.join(".")}=${String(value.value)}`);
      }
      break;
    case "enum":
      if (path.length) {
        out.push(`${path.join(".")}=${value.name ?? value.number}`);
      }
      break;
    case "message":
      for (const field of value.fields) {
        walk(field.value, [...path, field.name], out);
      }
      break;
    case "list":
      value.values.forEach((item, index) => walk(item, [...path, String(index)], out));
      break;
    default:
      break;
  }
}

function listEnumNames(option: DocOption): string[] {
  const value = option.value;
  if (value.kind === "enum") {
    return [value.name ?? String(value.number)];
  }
  if (value.kind === "list") {
    return value.values.filter((item) => item.kind === "enum").map((item) => (item.kind === "enum" ? (item.name ?? String(item.number)) : ""));
  }
  return [];
}
