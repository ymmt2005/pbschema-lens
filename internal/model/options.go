package model

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"
)

func (v OptionValue) MarshalJSON() ([]byte, error) {
	m := map[string]any{"kind": v.Kind}
	switch v.Kind {
	case "scalar":
		m["scalar"] = v.Scalar
		m["value"] = v.Value
	case "enum":
		m["enumType"] = v.EnumType
		if v.Name != "" {
			m["name"] = v.Name
		}
		m["number"] = v.Number
	case "message":
		m["typeName"] = v.TypeName
		if v.Fields == nil {
			v.Fields = []OptionField{}
		}
		m["fields"] = v.Fields
		m["textProto"] = v.TextProto
	case "list":
		if v.Values == nil {
			v.Values = []OptionValue{}
		}
		m["values"] = v.Values
	case "map":
		if v.Entries == nil {
			v.Entries = []OptionMapEntry{}
		}
		m["entries"] = v.Entries
	case "bytes":
		m["base64"] = v.Base64
	case "unknown":
		m["fieldNumber"] = v.FieldNumber
		m["wireType"] = v.WireType
		m["note"] = v.Note
	}
	return json.Marshal(m)
}

func (f OptionField) MarshalJSON() ([]byte, error) {
	m := map[string]any{
		"name":  f.Name,
		"value": f.Value,
	}
	if f.Number != 0 {
		m["number"] = f.Number
	}
	if f.Extension {
		m["extension"] = true
	}
	return json.Marshal(m)
}

func (e OptionMapEntry) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"key": e.Key, "value": e.Value})
}

var optionExtendees = map[string]string{
	"google.protobuf.FileOptions":      "file",
	"google.protobuf.MessageOptions":   "message",
	"google.protobuf.FieldOptions":     "field",
	"google.protobuf.OneofOptions":     "oneof",
	"google.protobuf.EnumOptions":      "enum",
	"google.protobuf.EnumValueOptions": "enum-value",
	"google.protobuf.ServiceOptions":   "service",
	"google.protobuf.MethodOptions":    "method",
}

func optionTargetOf(extendee protoreflect.FullName) string {
	return optionExtendees[string(extendee)]
}

func extensionTypes(files FileSource) *protoregistry.Types {
	types := new(protoregistry.Types)
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		registerFileExtensions(types, fd)
		return true
	})
	return types
}

func registerFileExtensions(types *protoregistry.Types, fd protoreflect.FileDescriptor) {
	registerExtensions(types, fd.Extensions())
	for i := 0; i < fd.Messages().Len(); i++ {
		registerMessageExtensions(types, fd.Messages().Get(i))
	}
}

func registerMessageExtensions(types *protoregistry.Types, md protoreflect.MessageDescriptor) {
	registerExtensions(types, md.Extensions())
	for i := 0; i < md.Messages().Len(); i++ {
		registerMessageExtensions(types, md.Messages().Get(i))
	}
}

func registerExtensions(types *protoregistry.Types, list protoreflect.ExtensionDescriptors) {
	for i := 0; i < list.Len(); i++ {
		_ = types.RegisterExtension(dynamicpb.NewExtensionType(list.Get(i)))
	}
}

// resolveOptions decodes custom options using extensions from the descriptor set.
// protodesc leaves those values uninterpreted unless a type resolver is supplied.
func resolveOptions(msg proto.Message, types *protoregistry.Types) proto.Message {
	if msg == nil || types == nil {
		return msg
	}
	raw, err := proto.Marshal(msg)
	if err != nil || len(raw) == 0 {
		return msg
	}
	out := msg.ProtoReflect().New().Interface()
	if err := (proto.UnmarshalOptions{Resolver: types, AllowPartial: true}).Unmarshal(raw, out); err != nil {
		return msg
	}
	return out
}

func extractOptions(msg protoreflect.Message, target string) []*DocOption {
	if msg == nil || !msg.IsValid() {
		return []*DocOption{}
	}
	var docs []*DocOption
	seen := map[int32]struct{}{}
	msg.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		name := string(fd.Name())
		if name == "uninterpreted_option" || name == "features" {
			return true
		}
		value := fieldToOption(fd, v)
		full := name
		ext := false
		var number int32
		var def string
		if fd.IsExtension() {
			ext = true
			full = string(fd.FullName())
			name = string(fd.Name())
			number = int32(fd.Number())
			def = "extension:" + full
		} else {
			number = int32(fd.Number())
		}
		seen[number] = struct{}{}
		docs = append(docs, &DocOption{
			Name:         name,
			FullName:     full,
			Number:       number,
			Extension:    ext,
			BuiltIn:      !ext,
			Target:       target,
			DefinitionID: def,
			Value:        value,
			TextProto:    formatAssignment(full, value, ext),
		})
		return true
	})
	docs = append(docs, unknownOptions(msg.GetUnknown(), target, seen)...)
	sort.SliceStable(docs, func(i, j int) bool { return docs[i].Number < docs[j].Number })
	for _, option := range docs {
		if semantic := renderSemantic(option); semantic != nil {
			option.Semantic = semantic
		}
	}
	if docs == nil {
		return []*DocOption{}
	}
	return docs
}

func unknownOptions(raw []byte, target string, seen map[int32]struct{}) []*DocOption {
	var docs []*DocOption
	for len(raw) > 0 {
		num, typ, n := protowire.ConsumeTag(raw)
		if n < 0 {
			break
		}
		raw = raw[n:]
		n = protowire.ConsumeFieldValue(num, typ, raw)
		if n < 0 {
			break
		}
		raw = raw[n:]
		if _, ok := seen[int32(num)]; ok {
			continue
		}
		seen[int32(num)] = struct{}{}
		value := OptionValue{
			Kind:        "unknown",
			FieldNumber: int32(num),
			WireType:    int(typ),
			Note:        "Uninterpreted option value. The defining extension was not present in the descriptor set.",
		}
		docs = append(docs, &DocOption{
			Name:      fmt.Sprintf("#%d", num),
			FullName:  fmt.Sprintf("uninterpreted.%d", num),
			Number:    int32(num),
			Extension: true,
			Target:    target,
			Value:     value,
			TextProto: fmt.Sprintf("(unknown field %d)", num),
		})
	}
	return docs
}

func fieldToOption(fd protoreflect.FieldDescriptor, v protoreflect.Value) OptionValue {
	if fd.IsList() {
		list := v.List()
		values := make([]OptionValue, 0, list.Len())
		for i := 0; i < list.Len(); i++ {
			values = append(values, scalarOrMessage(fd, list.Get(i)))
		}
		return OptionValue{Kind: "list", Values: values}
	}
	if fd.IsMap() {
		mp := v.Map()
		var entries []OptionMapEntry
		mp.Range(func(key protoreflect.MapKey, value protoreflect.Value) bool {
			entries = append(entries, OptionMapEntry{
				Key:   key.String(),
				Value: scalarOrMessage(fd.MapValue(), value),
			})
			return true
		})
		sort.Slice(entries, func(i, j int) bool { return entries[i].Key < entries[j].Key })
		return OptionValue{Kind: "map", Entries: entries}
	}
	return scalarOrMessage(fd, v)
}

func scalarOrMessage(fd protoreflect.FieldDescriptor, v protoreflect.Value) OptionValue {
	switch fd.Kind() {
	case protoreflect.MessageKind, protoreflect.GroupKind:
		return messageOption(v.Message())
	case protoreflect.EnumKind:
		ev := fd.Enum().Values().ByNumber(v.Enum())
		name := ""
		if ev != nil {
			name = string(ev.Name())
		}
		return OptionValue{Kind: "enum", EnumType: string(fd.Enum().FullName()), Name: name, Number: int32(v.Enum())}
	case protoreflect.BytesKind:
		return OptionValue{Kind: "bytes", Base64: base64.StdEncoding.EncodeToString(v.Bytes())}
	default:
		return OptionValue{Kind: "scalar", Scalar: scalarName(fd.Kind()), Value: scalarGo(fd.Kind(), v)}
	}
}

func messageOption(msg protoreflect.Message) OptionValue {
	var fields []OptionField
	msg.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		fields = append(fields, OptionField{
			Name:      string(fd.Name()),
			Number:    int32(fd.Number()),
			Extension: fd.IsExtension(),
			Value:     fieldToOption(fd, v),
		})
		return true
	})
	sort.Slice(fields, func(i, j int) bool { return fields[i].Number < fields[j].Number })
	lines := make([]string, 0, len(fields))
	for _, field := range fields {
		name := field.Name
		if field.Extension {
			name = "(" + name + ")"
		}
		lines = append(lines, name+" = "+formatValue(field.Value, 0))
	}
	return OptionValue{
		Kind:      "message",
		TypeName:  string(msg.Descriptor().FullName()),
		Fields:    fields,
		TextProto: strings.Join(lines, "\n"),
	}
}

func formatAssignment(name string, value OptionValue, extension bool) string {
	lhs := name
	if extension {
		lhs = "(" + name + ")"
	}
	return lhs + " = " + formatValue(value, 0)
}

func formatValue(value OptionValue, indent int) string {
	pad := strings.Repeat("  ", indent)
	inner := strings.Repeat("  ", indent+1)
	switch value.Kind {
	case "scalar":
		if s, ok := value.Value.(string); ok {
			return strconv.Quote(s)
		}
		return fmt.Sprint(value.Value)
	case "enum":
		if value.Name != "" {
			return value.Name
		}
		return strconv.FormatInt(int64(value.Number), 10)
	case "bytes":
		prefix := value.Base64
		if len(prefix) > 16 {
			prefix = prefix[:16]
		}
		return `"<bytes ` + prefix + `…>"`
	case "list":
		if len(value.Values) == 0 {
			return "[]"
		}
		parts := make([]string, len(value.Values))
		for i, item := range value.Values {
			parts[i] = inner + formatValue(item, indent+1)
		}
		return "[\n" + strings.Join(parts, ",\n") + "\n" + pad + "]"
	case "map":
		parts := make([]string, len(value.Entries))
		for i, entry := range value.Entries {
			parts[i] = inner + entry.Key + ": " + formatValue(entry.Value, indent+1)
		}
		return "{\n" + strings.Join(parts, "\n") + "\n" + pad + "}"
	case "message":
		if value.TextProto == "" {
			return "{}"
		}
		if !strings.Contains(value.TextProto, "\n") {
			return "{ " + value.TextProto + " }"
		}
		var lines []string
		for _, line := range strings.Split(value.TextProto, "\n") {
			if line != "" {
				lines = append(lines, inner+line)
			}
		}
		return "{\n" + strings.Join(lines, "\n") + "\n" + pad + "}"
	default:
		return "/* " + value.Note + " */"
	}
}

func scalarGo(kind protoreflect.Kind, v protoreflect.Value) any {
	switch kind {
	case protoreflect.BoolKind:
		return v.Bool()
	case protoreflect.StringKind:
		return v.String()
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		return int32(v.Int())
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		return strconv.FormatInt(v.Int(), 10)
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return uint32(v.Uint())
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return strconv.FormatUint(v.Uint(), 10)
	case protoreflect.FloatKind:
		return float32(v.Float())
	case protoreflect.DoubleKind:
		return v.Float()
	default:
		return v.String()
	}
}

func scalarName(kind protoreflect.Kind) string {
	switch kind {
	case protoreflect.DoubleKind:
		return "double"
	case protoreflect.FloatKind:
		return "float"
	case protoreflect.Int64Kind:
		return "int64"
	case protoreflect.Uint64Kind:
		return "uint64"
	case protoreflect.Int32Kind:
		return "int32"
	case protoreflect.Fixed64Kind:
		return "fixed64"
	case protoreflect.Fixed32Kind:
		return "fixed32"
	case protoreflect.BoolKind:
		return "bool"
	case protoreflect.StringKind:
		return "string"
	case protoreflect.BytesKind:
		return "bytes"
	case protoreflect.Uint32Kind:
		return "uint32"
	case protoreflect.Sfixed32Kind:
		return "sfixed32"
	case protoreflect.Sfixed64Kind:
		return "sfixed64"
	case protoreflect.Sint32Kind:
		return "sint32"
	case protoreflect.Sint64Kind:
		return "sint64"
	default:
		return "string"
	}
}
