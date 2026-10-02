package model

import (
	"strconv"
	"strings"
)

func renderSemantic(option *DocOption) *Semantic {
	switch {
	case option.FullName == "google.api.http" || option.Name == "http":
		methods := flattenHTTP(option.Value)
		badges := []string{"HTTP"}
		if len(methods) > 0 {
			badges = badges[:0]
			for _, method := range methods {
				verb := method
				if i := strings.IndexByte(method, ' '); i > 0 {
					verb = method[:i]
				}
				badges = append(badges, verb)
			}
		}
		summary := strings.Join(methods, " · ")
		if summary == "" {
			summary = "HTTP mapping"
		}
		return &Semantic{RendererID: "google.api.http", Title: "HTTP", Summary: summary, Badges: badges, Details: option.TextProto}
	case option.FullName == "cybozu.validate.ignored":
		return &Semantic{RendererID: "cybozu.validate", Title: "Cybozu validate", Summary: "Skip generated Validate() for this message", Badges: []string{"ignored"}, Details: option.TextProto}
	case option.FullName == "cybozu.validate.required":
		return &Semantic{RendererID: "cybozu.validate", Title: "Cybozu validate", Summary: "Oneof must be set", Badges: []string{"required"}, Details: option.TextProto}
	case option.FullName == "cybozu.validate.rules" || strings.HasPrefix(option.FullName, "cybozu.validate."):
		constraints := collectConstraints(option.Value, nil)
		summary := strings.Join(constraints, ", ")
		if summary == "" {
			summary = "Normalization and validation rules"
		}
		return &Semantic{RendererID: "cybozu.validate", Title: "Cybozu validate", Summary: summary, Badges: constraints, Details: option.TextProto}
	case strings.HasPrefix(option.FullName, "buf.validate.") || strings.HasPrefix(option.FullName, "validate."):
		constraints := collectConstraints(option.Value, nil)
		summary := strings.Join(constraints, ", ")
		if summary == "" {
			summary = "Validation constraints"
		}
		return &Semantic{RendererID: "validation", Title: "Validation", Summary: summary, Badges: constraints, Details: option.TextProto}
	case option.FullName == "google.api.field_behavior" || option.Name == "field_behavior":
		values := listEnumNames(option.Value)
		summary := strings.Join(values, ", ")
		if summary == "" {
			summary = "Field behavior"
		}
		return &Semantic{RendererID: "google.api.field_behavior", Title: "Field behavior", Summary: summary, Badges: values}
	case option.Name == "deprecated":
		if option.Value.Kind == "scalar" && option.Value.Value == true {
			return &Semantic{RendererID: "deprecated", Title: "Deprecated", Summary: "This declaration is deprecated and should not be used in new code.", Badges: []string{"deprecated"}}
		}
	}
	return nil
}

func flattenHTTP(value OptionValue) []string {
	if value.Kind != "message" {
		return nil
	}
	verbs := map[string]struct{}{"get": {}, "put": {}, "post": {}, "delete": {}, "patch": {}}
	var methods []string
	for _, field := range value.Fields {
		if _, ok := verbs[field.Name]; ok && field.Value.Kind == "scalar" {
			methods = append(methods, strings.ToUpper(field.Name)+" "+fmtString(field.Value.Value))
		}
		if field.Name == "custom" && field.Value.Kind == "message" {
			var kind, path string
			for _, child := range field.Value.Fields {
				if child.Name == "kind" && child.Value.Kind == "scalar" {
					kind = fmtString(child.Value.Value)
				}
				if child.Name == "path" && child.Value.Kind == "scalar" {
					path = fmtString(child.Value.Value)
				}
			}
			if kind != "" && path != "" {
				methods = append(methods, kind+" "+path)
			}
		}
		if field.Name == "additional_bindings" && field.Value.Kind == "list" {
			for _, item := range field.Value.Values {
				methods = append(methods, flattenHTTP(item)...)
			}
		}
		if field.Name == "body" && field.Value.Kind == "scalar" {
			methods = append(methods, "body="+fmtString(field.Value.Value))
		}
	}
	return methods
}

func collectConstraints(value OptionValue, path []string) []string {
	var out []string
	switch value.Kind {
	case "scalar":
		if b, ok := value.Value.(bool); ok && b && len(path) > 0 {
			out = append(out, strings.Join(path, "."))
		} else if len(path) > 0 && value.Value != false {
			out = append(out, strings.Join(path, ".")+"="+fmtString(value.Value))
		}
	case "enum":
		if len(path) > 0 {
			name := value.Name
			if name == "" {
				name = fmtString(value.Number)
			}
			out = append(out, strings.Join(path, ".")+"="+name)
		}
	case "message":
		for _, field := range value.Fields {
			out = append(out, collectConstraints(field.Value, append(append([]string{}, path...), field.Name))...)
		}
	case "list":
		for i, item := range value.Values {
			out = append(out, collectConstraints(item, append(append([]string{}, path...), fmtString(i)))...)
		}
	}
	return out
}

func listEnumNames(value OptionValue) []string {
	switch value.Kind {
	case "enum":
		if value.Name != "" {
			return []string{value.Name}
		}
		return []string{fmtString(value.Number)}
	case "list":
		var names []string
		for _, item := range value.Values {
			if item.Kind == "enum" {
				if item.Name != "" {
					names = append(names, item.Name)
				} else {
					names = append(names, fmtString(item.Number))
				}
			}
		}
		return names
	default:
		return nil
	}
}

func fmtString(value any) string {
	switch t := value.(type) {
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case int:
		return strconv.Itoa(t)
	case int32:
		return strconv.FormatInt(int64(t), 10)
	case int64:
		return strconv.FormatInt(t, 10)
	case uint32:
		return strconv.FormatUint(uint64(t), 10)
	case uint64:
		return strconv.FormatUint(t, 10)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return ""
	}
}
