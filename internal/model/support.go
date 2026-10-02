package model

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/classify"
	"github.com/ymmt2005/pbschema-lens/internal/markdown"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

var starLine = regexp.MustCompile(`(?m)^\s*\*\s?`)

func fieldRanges(list protoreflect.FieldRanges) []ReservedRange {
	out := make([]ReservedRange, 0, list.Len())
	for i := 0; i < list.Len(); i++ {
		span := list.Get(i)
		out = append(out, ReservedRange{Start: int32(span[0]), End: int32(span[1])})
	}
	return out
}

func enumRangeList(list protoreflect.EnumRanges) []ReservedRange {
	out := make([]ReservedRange, 0, list.Len())
	for i := 0; i < list.Len(); i++ {
		span := list.Get(i)
		out = append(out, ReservedRange{Start: int32(span[0]), End: int32(span[1])})
	}
	return out
}

func nameList(list protoreflect.Names) []string {
	out := make([]string, 0, list.Len())
	for i := 0; i < list.Len(); i++ {
		out = append(out, string(list.Get(i)))
	}
	return out
}

func enumOpen(ed protoreflect.EnumDescriptor) bool {
	if ed.Syntax() == protoreflect.Proto2 {
		return false
	}
	opts, _ := ed.Options().(*descriptorpb.EnumOptions)
	if opts != nil && opts.Features != nil && opts.Features.EnumType != nil {
		return *opts.Features.EnumType != descriptorpb.FeatureSet_CLOSED
	}
	return true
}

func messageFeatures(md protoreflect.MessageDescriptor) []EffectiveFeature {
	declared := ""
	if opts, ok := md.Options().(*descriptorpb.MessageOptions); ok && opts != nil && opts.Features != nil && opts.Features.JsonFormat != nil {
		declared = opts.Features.JsonFormat.String()
	}
	effective := "ALLOW"
	if file := md.ParentFile(); file != nil && file.Syntax() == protoreflect.Proto2 {
		effective = "LEGACY_BEST_EFFORT"
	}
	if declared != "" {
		effective = declared
		return []EffectiveFeature{{Name: "json_format", Declared: declared, Effective: effective, Source: "declared"}}
	}
	from := ""
	if file := md.ParentFile(); file != nil {
		from = string(file.Path())
	}
	return []EffectiveFeature{{Name: "json_format", Effective: effective, Source: "inherited", InheritedFrom: from}}
}

func fieldFeatures(fd protoreflect.FieldDescriptor, parent string) []EffectiveFeature {
	features := []EffectiveFeature{feature("field_presence", presenceOf(fd), "", parent)}
	features = append(features, feature("utf8_validation", utf8Of(fd), "", parent))
	if fd.IsList() && !fd.IsMap() {
		encoding := "EXPANDED"
		if fd.IsPacked() {
			encoding = "PACKED"
		}
		features = append(features, feature("repeated_field_encoding", encoding, "", parent))
	}
	return features
}

func enumFeatures(ed protoreflect.EnumDescriptor) []EffectiveFeature {
	kind := "CLOSED"
	if enumOpen(ed) {
		kind = "OPEN"
	}
	return []EffectiveFeature{feature("enum_type", kind, "", string(ed.ParentFile().Path()))}
}

func extensionFeatures(ext protoreflect.FieldDescriptor) []EffectiveFeature {
	return []EffectiveFeature{feature("field_presence", presenceOf(ext), "", string(ext.ParentFile().Path()))}
}

func utf8Of(fd protoreflect.FieldDescriptor) string {
	if fd.Syntax() == protoreflect.Proto2 {
		return "NONE"
	}
	return "VERIFY"
}

func feature(name, effective, declared, inherited string) EffectiveFeature {
	if declared != "" {
		return EffectiveFeature{Name: name, Declared: declared, Effective: effective, Source: "declared"}
	}
	return EffectiveFeature{Name: name, Effective: effective, Source: "inherited", InheritedFrom: inherited}
}

func sortByName(files []*DocFile) {
	sort.Slice(files, func(i, j int) bool { return files[i].FullName < files[j].FullName })
}
func sortByNameMsg(items []*DocMessage) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameField(items []*DocField) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameOneof(items []*DocOneof) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameEnum(items []*DocEnum) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameValue(items []*DocEnumValue) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameSvc(items []*DocService) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameMethod(items []*DocMethod) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}
func sortByNameExt(items []*DocExtension) {
	sort.Slice(items, func(i, j int) bool { return items[i].FullName < items[j].FullName })
}

func excludedIDs(model *SchemaModel, patterns []string) map[string]bool {
	ids := map[string]bool{}
	if len(patterns) == 0 {
		return ids
	}
	for _, base := range allBases(model) {
		if base.Kind == "package" {
			continue
		}
		if classify.Excluded(base.FileName, base.PackageName, patterns) {
			ids[base.ID] = true
		}
	}
	for _, pkg := range model.Packages {
		if len(pkg.FileIDs) == 0 {
			continue
		}
		all := true
		for _, id := range pkg.FileIDs {
			if !ids[id] {
				all = false
				break
			}
		}
		if all {
			ids[pkg.ID] = true
		}
	}
	return ids
}

func allBases(model *SchemaModel) []*baseSymbol {
	out := make([]*baseSymbol, 0, len(model.Symbols))
	for id := range model.Symbols {
		if base, ok := basePtr(model.Symbols[id]); ok {
			out = append(out, base)
		}
		_ = id
	}
	return out
}

func basePtr(symbol any) (*baseSymbol, bool) {
	switch s := symbol.(type) {
	case *DocPackage:
		return &s.baseSymbol, true
	case *DocFile:
		return &s.baseSymbol, true
	case *DocMessage:
		return &s.baseSymbol, true
	case *DocField:
		return &s.baseSymbol, true
	case *DocOneof:
		return &s.baseSymbol, true
	case *DocEnum:
		return &s.baseSymbol, true
	case *DocEnumValue:
		return &s.baseSymbol, true
	case *DocService:
		return &s.baseSymbol, true
	case *DocMethod:
		return &s.baseSymbol, true
	case *DocExtension:
		return &s.baseSymbol, true
	default:
		return nil, false
	}
}

func attachReferences(model *SchemaModel, refs []SymbolReference) {
	for _, ref := range refs {
		if from, ok := basePtr(model.Symbols[ref.FromID]); ok {
			from.References = append(from.References, ref)
		}
		if to, ok := basePtr(model.Symbols[ref.ToID]); ok {
			to.ReferencedBy = append(to.ReferencedBy, ref)
		}
	}
}

func promotePages(model *SchemaModel, excluded map[string]bool) {
	changed := true
	for changed {
		changed = false
		for _, symbol := range model.Symbols {
			base, ok := basePtr(symbol)
			if !ok || !onPage(model, base) {
				continue
			}
			for _, ref := range base.ReferencedBy {
				if ensureAnchor(model, model.Symbols[ref.FromID], excluded) {
					changed = true
				}
			}
			if msg, ok := symbol.(*DocMessage); ok {
				for _, id := range msg.FieldIDs {
					if ensureTypes(model, model.Symbols[id], excluded) {
						changed = true
					}
				}
			}
			if svc, ok := symbol.(*DocService); ok {
				for _, id := range svc.MethodIDs {
					if ensureTypes(model, model.Symbols[id], excluded) {
						changed = true
					}
				}
			}
			if ensureTypes(model, symbol, excluded) {
				changed = true
			}
		}
		for _, symbol := range model.Symbols {
			base, ok := basePtr(symbol)
			if !ok || base.GeneratePage {
				continue
			}
			switch base.Kind {
			case "message", "enum", "service", "extension":
			default:
				continue
			}
			fromDoc := false
			for _, ref := range base.ReferencedBy {
				if other, ok := basePtr(model.Symbols[ref.FromID]); ok && onPage(model, other) {
					fromDoc = true
					break
				}
			}
			if fromDoc && publish(symbol, excluded) {
				changed = true
			}
		}
	}
	for _, method := range model.Methods {
		if svc, ok := basePtr(model.Symbols[method.ParentID]); ok && svc.GeneratePage {
			method.GeneratePage = true
		}
	}
	scrubTypes(model)
}

func onPage(model *SchemaModel, base *baseSymbol) bool {
	if base == nil {
		return false
	}
	if base.GeneratePage || base.Domain == string(classify.DomainLocal) {
		return true
	}
	if parent := parentID(model.Symbols[base.ID]); parent != "" {
		if p, ok := basePtr(model.Symbols[parent]); ok && p.GeneratePage {
			return true
		}
	}
	return false
}

func parentID(symbol any) string {
	switch s := symbol.(type) {
	case *DocField:
		return s.ParentID
	case *DocOneof:
		return s.ParentID
	case *DocMethod:
		return s.ParentID
	case *DocEnumValue:
		return s.ParentID
	case *DocMessage:
		return s.ParentID
	case *DocEnum:
		return s.ParentID
	default:
		return ""
	}
}

func ensureAnchor(model *SchemaModel, symbol any, excluded map[string]bool) bool {
	switch s := symbol.(type) {
	case *DocField:
		return publish(model.Symbols[s.ParentID], excluded)
	case *DocOneof:
		return publish(model.Symbols[s.ParentID], excluded)
	case *DocMethod:
		return publish(model.Symbols[s.ParentID], excluded)
	case *DocEnumValue:
		return publish(model.Symbols[s.ParentID], excluded)
	default:
		return publish(symbol, excluded)
	}
}

func ensureTypes(model *SchemaModel, symbol any, excluded map[string]bool) bool {
	base, ok := basePtr(symbol)
	if !ok || !onPage(model, base) {
		return false
	}
	changed := false
	for _, ref := range typeRefs(symbol) {
		if ref.ID == "" {
			continue
		}
		if publish(model.Symbols[ref.ID], excluded) {
			changed = true
		}
	}
	return changed
}

func publish(symbol any, excluded map[string]bool) bool {
	base, ok := basePtr(symbol)
	if !ok || base.GeneratePage || excluded[base.ID] {
		return false
	}
	if msg, ok := symbol.(*DocMessage); ok && msg.MapEntry {
		return false
	}
	if base.Domain == string(classify.DomainExternalDoc) || base.Domain == string(classify.DomainWellKnown) {
		return false
	}
	switch base.Kind {
	case "message", "enum", "service", "extension", "package":
		base.GeneratePage = true
		base.InNav = false
		return true
	default:
		return false
	}
}

func typeRefs(symbol any) []TypeRef {
	switch s := symbol.(type) {
	case *DocField:
		refs := []TypeRef{s.Type}
		if s.MapKey != nil {
			refs = append(refs, *s.MapKey)
		}
		if s.MapValue != nil {
			refs = append(refs, *s.MapValue)
		}
		return refs
	case *DocMethod:
		return []TypeRef{s.Input, s.Output}
	case *DocExtension:
		return []TypeRef{s.Extendee, s.Type}
	default:
		return nil
	}
}

func scrubTypes(model *SchemaModel) {
	scrub := func(ref *TypeRef) {
		if ref == nil || ref.ID == "" || ref.URLPath == "" {
			return
		}
		target, ok := basePtr(model.Symbols[ref.ID])
		if !ok || !target.GeneratePage {
			ref.URLPath = ""
		}
	}
	for _, field := range model.Fields {
		scrub(&field.Type)
		scrub(field.MapKey)
		scrub(field.MapValue)
	}
	for _, method := range model.Methods {
		scrub(&method.Input)
		scrub(&method.Output)
	}
	for _, ext := range model.Extensions {
		scrub(&ext.Extendee)
		scrub(&ext.Type)
	}
}

func indexFor(model *SchemaModel, excluded map[string]bool) []SymbolIndexEntry {
	var entries []SymbolIndexEntry
	add := func(base *baseSymbol) {
		if base.Kind == "message" {
			if msg, ok := model.Symbols[base.ID].(*DocMessage); ok && msg.MapEntry {
				return
			}
		}
		path := base.URLPath
		if base.Anchor != "" {
			path += "#" + base.Anchor
		}
		entries = append(entries, SymbolIndexEntry{
			ID: base.ID, Name: base.ShortName, FullName: base.FullName, Kind: base.Kind,
			Package: base.PackageName, URLPath: path,
		})
	}
	for _, item := range model.Packages {
		add(&item.baseSymbol)
	}
	for _, item := range model.Services {
		add(&item.baseSymbol)
	}
	for _, item := range model.Methods {
		add(&item.baseSymbol)
	}
	for _, item := range model.Messages {
		add(&item.baseSymbol)
	}
	for _, item := range model.Fields {
		add(&item.baseSymbol)
	}
	for _, item := range model.Enums {
		add(&item.baseSymbol)
	}
	for _, item := range model.EnumValues {
		add(&item.baseSymbol)
	}
	for _, item := range model.Extensions {
		add(&item.baseSymbol)
	}
	for _, item := range model.Files {
		add(&item.baseSymbol)
	}
	filtered := entries[:0]
	for _, entry := range entries {
		if excluded[entry.ID] {
			continue
		}
		symbol := model.Symbols[entry.ID]
		base, ok := basePtr(symbol)
		if !ok || !pageHost(model, base).GeneratePage {
			continue
		}
		filtered = append(filtered, entry)
	}
	sort.Slice(filtered, func(i, j int) bool { return filtered[i].FullName < filtered[j].FullName })
	if filtered == nil {
		return []SymbolIndexEntry{}
	}
	return filtered
}

func pageHost(model *SchemaModel, base *baseSymbol) *baseSymbol {
	switch base.Kind {
	case "field", "oneof", "enum-value", "method", "message", "enum":
		if parent := parentID(model.Symbols[base.ID]); parent != "" {
			if p, ok := basePtr(model.Symbols[parent]); ok {
				return pageHost(model, p)
			}
		}
	}
	return base
}

func wktNotes() map[string]string {
	raw := map[string]string{
		"google.protobuf.Any":       "A message that can contain any protobuf message, identified by a type URL.\n\n**JSON:** `{\"@type\": \"type.googleapis.com/pkg.Message\", ...fields}`\n\nUnpack at runtime using the type URL. Prefer a concrete field when the type is known.",
		"google.protobuf.Timestamp": "A point in time, independent of time zone, encoded as UTC seconds and nanoseconds since the Unix epoch (1970-01-01T00:00:00Z).\n\n**JSON:** an RFC 3339 string such as `\"2026-09-18T17:30:00Z\"`.\n\nRange is approximately 0001-01-01 to 9999-12-31.",
		"google.protobuf.Duration":  "A signed span of time as seconds plus nanoseconds.\n\n**JSON:** a string ending in `s`, for example `\"3.000000001s\"` or `\"-1.5s\"`.",
		"google.protobuf.Empty":     "A message with no fields. Common as an RPC request or response when no payload is needed.",
		"google.protobuf.FieldMask": "A set of field paths used for partial updates.\n\n**JSON:** a comma-separated string of lower-camel field paths, for example `\"user.displayName,photo\"`.",
		"google.protobuf.Struct":    "A JSON-object-like map of string keys to dynamically typed values.\n\n**JSON:** a JSON object.",
		"google.protobuf.Value":     "A dynamically typed value (null, number, string, bool, struct, or list).\n\n**JSON:** any JSON value.",
		"google.protobuf.ListValue": "A wrapper for a repeated `Value`.\n\n**JSON:** a JSON array.",
		"google.protobuf.NullValue": "A singleton enum representing JSON `null`.",
	}
	out := map[string]string{}
	for name, note := range raw {
		out[name] = markdown.RenderSafe(note)
	}
	return out
}

func exampleJSON(message *DocMessage, model *SchemaModel, depth int) any {
	if depth > 4 {
		return map[string]any{}
	}
	object := map[string]any{}
	for _, id := range message.FieldIDs {
		field, _ := model.Symbols[id].(*DocField)
		if field == nil || field.Deprecated {
			continue
		}
		object[field.JSONName] = exampleField(field, model, depth)
	}
	return object
}

func exampleText(message *DocMessage, model *SchemaModel) string {
	object, _ := exampleJSON(message, model, 0).(map[string]any)
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, formatTextField(key, object[key], 0))
	}
	return strings.Join(lines, "\n")
}

func exampleField(field *DocField, model *SchemaModel, depth int) any {
	switch field.Cardinality {
	case "map":
		return map[string]any{"key": exampleType(field.MapValue, model, depth+1)}
	case "repeated":
		return []any{exampleType(&field.Type, model, depth+1)}
	default:
		return exampleType(&field.Type, model, depth+1)
	}
}

func exampleType(ref *TypeRef, model *SchemaModel, depth int) any {
	if ref == nil {
		return nil
	}
	if ref.Kind == "scalar" {
		switch ref.Name {
		case "bool":
			return true
		case "string":
			return "string"
		case "bytes":
			return "Ynl0ZXM="
		case "double", "float":
			return 1.5
		default:
			return 1
		}
	}
	if ref.Kind == "enum" {
		if doc, ok := model.Symbols[ref.ID].(*DocEnum); ok && len(doc.ValueIDs) > 0 {
			if value, ok := model.Symbols[doc.ValueIDs[0]].(*DocEnumValue); ok {
				return value.ShortName
			}
		}
		return ref.Name
	}
	switch ref.Name {
	case "google.protobuf.Timestamp":
		return "2026-09-18T17:30:00Z"
	case "google.protobuf.Duration":
		return "1.500s"
	case "google.protobuf.Empty":
		return map[string]any{}
	case "google.protobuf.FieldMask":
		return "displayName,email"
	}
	if msg, ok := model.Symbols[ref.ID].(*DocMessage); ok {
		return exampleJSON(msg, model, depth+1)
	}
	return map[string]any{}
}

func formatTextField(key string, value any, indent int) string {
	pad := strings.Repeat("  ", indent)
	switch v := value.(type) {
	case []any:
		lines := make([]string, len(v))
		for i, item := range v {
			lines[i] = formatTextField(key, item, indent)
		}
		return strings.Join(lines, "\n")
	case map[string]any:
		keys := make([]string, 0, len(v))
		for child := range v {
			keys = append(keys, child)
		}
		sort.Strings(keys)
		body := make([]string, len(keys))
		for i, child := range keys {
			body[i] = formatTextField(child, v[child], indent+1)
		}
		return pad + key + " {\n" + strings.Join(body, "\n") + "\n" + pad + "}"
	case string:
		return pad + key + ": \"" + v + "\""
	case bool:
		if v {
			return pad + key + ": true"
		}
		return pad + key + ": false"
	default:
		return pad + key + ": " + plainExample(v)
	}
}

func plainExample(v any) string {
	switch t := v.(type) {
	case int:
		return strconv.Itoa(t)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return fmt.Sprint(v)
	}
}
