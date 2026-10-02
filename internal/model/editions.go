package model

import (
	"strings"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

// fieldFeatures reports effective edition features for a field, including
// declared overrides and the ancestor they were inherited from.
func fieldFeatures(fd protoreflect.FieldDescriptor, parent string) []EffectiveFeature {
	features := []EffectiveFeature{
		describeFeature(fd, "field_presence", presenceOf(fd), pickFieldPresence),
		describeFeature(fd, "utf8_validation", inheritedString(fd, utf8Default(fd.ParentFile()), pickUTF8), pickUTF8),
	}
	if fd.IsList() && !fd.IsMap() {
		encoding := "EXPANDED"
		if fd.IsPacked() {
			encoding = "PACKED"
		}
		features = append(features, describeFeature(fd, "repeated_field_encoding", encoding, pickRepeated))
	}
	if fd.Kind() == protoreflect.MessageKind || fd.Kind() == protoreflect.GroupKind ||
		(fd.IsList() && fd.Message() != nil) {
		encoding := inheritedString(fd, "LENGTH_PREFIXED", pickMessageEncoding)
		if fd.Kind() == protoreflect.GroupKind {
			encoding = "DELIMITED"
		}
		features = append(features, describeFeature(fd, "message_encoding", encoding, pickMessageEncoding))
	}
	_ = parent
	return features
}

func messageFeatures(md protoreflect.MessageDescriptor) []EffectiveFeature {
	effective := inheritedString(md, jsonDefault(md.ParentFile()), pickJSON)
	return []EffectiveFeature{describeFeature(md, "json_format", effective, pickJSON)}
}

func enumFeatures(ed protoreflect.EnumDescriptor) []EffectiveFeature {
	kind := "OPEN"
	if ed.IsClosed() {
		kind = "CLOSED"
	}
	return []EffectiveFeature{describeFeature(ed, "enum_type", kind, pickEnumType)}
}

func extensionFeatures(ext protoreflect.FieldDescriptor) []EffectiveFeature {
	return []EffectiveFeature{describeFeature(ext, "field_presence", presenceOf(ext), pickFieldPresence)}
}

func enumOpen(ed protoreflect.EnumDescriptor) bool {
	return !ed.IsClosed()
}

func describeFeature(self protoreflect.Descriptor, name, effective string, pick func(*descriptorpb.FeatureSet) string) EffectiveFeature {
	if declared := pick(featureSetOf(self)); declared != "" {
		return EffectiveFeature{Name: name, Declared: declared, Effective: effective, Source: "declared"}
	}
	for _, ancestor := range ancestors(self) {
		if pick(featureSetOf(ancestor)) == "" {
			continue
		}
		return EffectiveFeature{Name: name, Effective: effective, Source: "inherited", InheritedFrom: ancestorLabel(ancestor)}
	}
	from := fileDisplayName(self.ParentFile())
	source := "edition-default"
	if from != "" {
		source = "inherited"
	}
	return EffectiveFeature{Name: name, Effective: effective, Source: source, InheritedFrom: from}
}

func inheritedString(self protoreflect.Descriptor, fallback string, pick func(*descriptorpb.FeatureSet) string) string {
	nodes := append([]protoreflect.Descriptor{self}, ancestors(self)...)
	effective := fallback
	for i := len(nodes) - 1; i >= 0; i-- {
		if value := pick(featureSetOf(nodes[i])); value != "" {
			effective = value
		}
	}
	return effective
}

func ancestors(self protoreflect.Descriptor) []protoreflect.Descriptor {
	var out []protoreflect.Descriptor
	parent := self.Parent()
	for parent != nil && parent != self {
		out = append(out, parent)
		next := parent.Parent()
		if next == parent {
			break
		}
		parent = next
	}
	return out
}

func ancestorLabel(d protoreflect.Descriptor) string {
	if file, ok := d.(protoreflect.FileDescriptor); ok {
		return fileDisplayName(file)
	}
	return string(d.FullName())
}

// fileDisplayName is the protobuf-es file name: the path without a .proto suffix.
func fileDisplayName(file protoreflect.FileDescriptor) string {
	if file == nil {
		return ""
	}
	return strings.TrimSuffix(file.Path(), ".proto")
}

func featureSetOf(d protoreflect.Descriptor) *descriptorpb.FeatureSet {
	switch d := d.(type) {
	case protoreflect.FileDescriptor:
		if opts, ok := d.Options().(*descriptorpb.FileOptions); ok && opts != nil {
			return opts.Features
		}
	case protoreflect.MessageDescriptor:
		if opts, ok := d.Options().(*descriptorpb.MessageOptions); ok && opts != nil {
			return opts.Features
		}
	case protoreflect.FieldDescriptor:
		if opts, ok := d.Options().(*descriptorpb.FieldOptions); ok && opts != nil {
			return opts.Features
		}
	case protoreflect.EnumDescriptor:
		if opts, ok := d.Options().(*descriptorpb.EnumOptions); ok && opts != nil {
			return opts.Features
		}
	}
	return nil
}

func pickFieldPresence(fs *descriptorpb.FeatureSet) string {
	if fs == nil || fs.FieldPresence == nil {
		return ""
	}
	return featureName(fs.FieldPresence.String())
}

func pickUTF8(fs *descriptorpb.FeatureSet) string {
	if fs == nil || fs.Utf8Validation == nil {
		return ""
	}
	return featureName(fs.Utf8Validation.String())
}

func pickRepeated(fs *descriptorpb.FeatureSet) string {
	if fs == nil || fs.RepeatedFieldEncoding == nil {
		return ""
	}
	return featureName(fs.RepeatedFieldEncoding.String())
}

func pickMessageEncoding(fs *descriptorpb.FeatureSet) string {
	if fs == nil || fs.MessageEncoding == nil {
		return ""
	}
	return featureName(fs.MessageEncoding.String())
}

func pickJSON(fs *descriptorpb.FeatureSet) string {
	if fs == nil || fs.JsonFormat == nil {
		return ""
	}
	return featureName(fs.JsonFormat.String())
}

func pickEnumType(fs *descriptorpb.FeatureSet) string {
	if fs == nil || fs.EnumType == nil {
		return ""
	}
	return featureName(fs.EnumType.String())
}

func featureName(value string) string {
	if value == "" || strings.Contains(value, "UNKNOWN") {
		return ""
	}
	return value
}

func utf8Default(file protoreflect.FileDescriptor) string {
	if file != nil && file.Syntax() == protoreflect.Proto2 {
		return "NONE"
	}
	return "VERIFY"
}

func jsonDefault(file protoreflect.FileDescriptor) string {
	if file != nil && file.Syntax() == protoreflect.Proto2 {
		return "LEGACY_BEST_EFFORT"
	}
	return "ALLOW"
}
