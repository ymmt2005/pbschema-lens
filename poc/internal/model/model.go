// Package model turns a FileDescriptorSet into the small JSON document the
// proof-of-concept page renders. It is not SchemaModel.
package model

import (
	"fmt"
	"net/url"
	"sort"
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Model is the JSON written to model.json.
type Model struct {
	Title    string    `json:"title"`
	Files    []File    `json:"files"`
	Messages []Message `json:"messages"`
	Enums    []Enum    `json:"enums"`
	Services []Service `json:"services"`
}

// File is one .proto path kept in the documented set.
type File struct {
	Path    string `json:"path"`
	Package string `json:"package"`
}

// Message is a top-level or nested message.
type Message struct {
	FullName string  `json:"fullName"`
	Package  string  `json:"package"`
	File     string  `json:"file"`
	URLPath  string  `json:"urlPath"`
	Fields   []Field `json:"fields"`
}

// Field is one message field.
type Field struct {
	Name   string `json:"name"`
	Number int32  `json:"number"`
	Type   string `json:"type"`
	Oneof  string `json:"oneof,omitempty"`
}

// Enum is a top-level or nested enum.
type Enum struct {
	FullName string      `json:"fullName"`
	Package  string      `json:"package"`
	Values   []EnumValue `json:"values"`
}

// EnumValue is one enum constant.
type EnumValue struct {
	Name   string `json:"name"`
	Number int32  `json:"number"`
}

// Service is one RPC service.
type Service struct {
	FullName string   `json:"fullName"`
	Package  string   `json:"package"`
	Methods  []Method `json:"methods"`
}

// Method is one RPC method.
type Method struct {
	Name   string `json:"name"`
	Input  string `json:"input"`
	Output string `json:"output"`
}

// Build unmarshals a FileDescriptorSet and returns the documented symbols.
func Build(descriptorSet []byte, title string) (*Model, error) {
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(descriptorSet, &set); err != nil {
		return nil, fmt.Errorf("parse file descriptor set: %w", err)
	}
	files, err := protodesc.NewFiles(&set)
	if err != nil {
		return nil, fmt.Errorf("load descriptors: %w", err)
	}
	model := &Model{Title: title}
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		path := fd.Path()
		if !IncludeFile(path) {
			return true
		}
		model.Files = append(model.Files, File{Path: path, Package: string(fd.Package())})
		msgs := fd.Messages()
		for i := 0; i < msgs.Len(); i++ {
			walkMessage(fd, msgs.Get(i), model)
		}
		enums := fd.Enums()
		for i := 0; i < enums.Len(); i++ {
			model.Enums = append(model.Enums, enumFrom(fd, enums.Get(i)))
		}
		svcs := fd.Services()
		for i := 0; i < svcs.Len(); i++ {
			model.Services = append(model.Services, serviceFrom(svcs.Get(i)))
		}
		return true
	})
	sort.Slice(model.Files, func(i, j int) bool { return model.Files[i].Path < model.Files[j].Path })
	sort.Slice(model.Messages, func(i, j int) bool { return model.Messages[i].FullName < model.Messages[j].FullName })
	sort.Slice(model.Enums, func(i, j int) bool { return model.Enums[i].FullName < model.Enums[j].FullName })
	sort.Slice(model.Services, func(i, j int) bool { return model.Services[i].FullName < model.Services[j].FullName })
	return model, nil
}

// IncludeFile reports whether a descriptor file is shown.
//
// This is a stand-in for src/core/classify.ts. Dependency protos that Buf
// pulls in for options are left out so the page shows the module being
// documented. The real classifier is part of the full port, not this proof.
func IncludeFile(path string) bool {
	for _, prefix := range []string{"google/", "buf/", "cybozu/"} {
		if strings.HasPrefix(path, prefix) {
			return false
		}
	}
	return true
}

func walkMessage(fd protoreflect.FileDescriptor, md protoreflect.MessageDescriptor, model *Model) {
	if md.IsMapEntry() {
		return
	}
	model.Messages = append(model.Messages, messageFrom(fd, md))
	nested := md.Messages()
	for i := 0; i < nested.Len(); i++ {
		walkMessage(fd, nested.Get(i), model)
	}
	enums := md.Enums()
	for i := 0; i < enums.Len(); i++ {
		model.Enums = append(model.Enums, enumFrom(fd, enums.Get(i)))
	}
}

func messageFrom(fd protoreflect.FileDescriptor, md protoreflect.MessageDescriptor) Message {
	full := string(md.FullName())
	msg := Message{
		FullName: full,
		Package:  string(fd.Package()),
		File:     fd.Path(),
		URLPath:  "/reference/messages/" + url.PathEscape(full) + "/",
		Fields:   []Field{},
	}
	fields := md.Fields()
	for i := 0; i < fields.Len(); i++ {
		f := fields.Get(i)
		field := Field{
			Name:   string(f.Name()),
			Number: int32(f.Number()),
			Type:   fieldType(f),
		}
		if oo := f.ContainingOneof(); oo != nil && !oo.IsSynthetic() {
			field.Oneof = string(oo.Name())
		}
		msg.Fields = append(msg.Fields, field)
	}
	return msg
}

func enumFrom(fd protoreflect.FileDescriptor, ed protoreflect.EnumDescriptor) Enum {
	enum := Enum{
		FullName: string(ed.FullName()),
		Package:  string(fd.Package()),
		Values:   []EnumValue{},
	}
	values := ed.Values()
	for i := 0; i < values.Len(); i++ {
		v := values.Get(i)
		enum.Values = append(enum.Values, EnumValue{Name: string(v.Name()), Number: int32(v.Number())})
	}
	return enum
}

func serviceFrom(sd protoreflect.ServiceDescriptor) Service {
	svc := Service{
		FullName: string(sd.FullName()),
		Package:  string(sd.ParentFile().Package()),
		Methods:  []Method{},
	}
	methods := sd.Methods()
	for i := 0; i < methods.Len(); i++ {
		m := methods.Get(i)
		svc.Methods = append(svc.Methods, Method{
			Name:   string(m.Name()),
			Input:  string(m.Input().FullName()),
			Output: string(m.Output().FullName()),
		})
	}
	return svc
}

func fieldType(f protoreflect.FieldDescriptor) string {
	if f.IsMap() {
		return "map<" + scalarName(f.MapKey().Kind()) + ", " + valueType(f.MapValue()) + ">"
	}
	name := valueType(f)
	if f.IsList() {
		return "repeated " + name
	}
	return name
}

func valueType(f protoreflect.FieldDescriptor) string {
	switch f.Kind() {
	case protoreflect.MessageKind, protoreflect.GroupKind:
		return string(f.Message().FullName())
	case protoreflect.EnumKind:
		return string(f.Enum().FullName())
	default:
		return scalarName(f.Kind())
	}
}

func scalarName(k protoreflect.Kind) string {
	switch k {
	case protoreflect.BoolKind:
		return "bool"
	case protoreflect.Int32Kind:
		return "int32"
	case protoreflect.Sint32Kind:
		return "sint32"
	case protoreflect.Sfixed32Kind:
		return "sfixed32"
	case protoreflect.Int64Kind:
		return "int64"
	case protoreflect.Sint64Kind:
		return "sint64"
	case protoreflect.Sfixed64Kind:
		return "sfixed64"
	case protoreflect.Uint32Kind:
		return "uint32"
	case protoreflect.Fixed32Kind:
		return "fixed32"
	case protoreflect.Uint64Kind:
		return "uint64"
	case protoreflect.Fixed64Kind:
		return "fixed64"
	case protoreflect.FloatKind:
		return "float"
	case protoreflect.DoubleKind:
		return "double"
	case protoreflect.StringKind:
		return "string"
	case protoreflect.BytesKind:
		return "bytes"
	default:
		return k.String()
	}
}
