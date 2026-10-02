package model

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ymmt2005/pbschema-lens/internal/classify"
	"github.com/ymmt2005/pbschema-lens/internal/markdown"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// BuildOptions controls one schema model.
type BuildOptions struct {
	Title          string
	InputLabel     string
	Classification classify.Config
	Source         *SourceConfig
	SourceTexts    map[string]string
	Warnings       []string
	Commit         string
}

// FileSource is the set of files resolved from a FileDescriptorSet.
type FileSource interface {
	RangeFiles(func(protoreflect.FileDescriptor) bool)
}

// Build walks a resolved file registry into a SchemaModel.
func Build(files FileSource, options BuildOptions) (*SchemaModel, error) {
	b := &builder{
		options:    options,
		symbols:    map[string]any{},
		byFullName: map[string]string{},
		packages:   map[string]*DocPackage{},
		extTypes:   extensionTypes(files),
	}
	var names []string
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		names = append(names, string(fd.Path()))
		return true
	})
	sort.Strings(names)
	byPath := map[string]protoreflect.FileDescriptor{}
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		byPath[string(fd.Path())] = fd
		return true
	})
	for _, name := range names {
		if err := b.walkFile(byPath[name]); err != nil {
			return nil, err
		}
	}
	return b.finish(), nil
}

type builder struct {
	options    BuildOptions
	symbols    map[string]any
	byFullName map[string]string
	packages   map[string]*DocPackage
	files      []*DocFile
	messages   []*DocMessage
	fields     []*DocField
	oneofs     []*DocOneof
	enums      []*DocEnum
	values     []*DocEnumValue
	services   []*DocService
	methods    []*DocMethod
	exts       []*DocExtension
	forward    []SymbolReference
	extTypes   *protoregistry.Types
}

func (b *builder) optionsOf(msg proto.Message, target string) []*DocOption {
	resolved := resolveOptions(msg, b.extTypes)
	if resolved == nil {
		return []*DocOption{}
	}
	return extractOptions(resolved.ProtoReflect(), target)
}

func (b *builder) remember(symbol any, base *baseSymbol) {
	b.symbols[base.ID] = symbol
	b.byFullName[base.Kind+":"+base.FullName] = base.ID
	switch base.Kind {
	case "field", "enum-value", "method", "oneof":
	default:
		b.byFullName[base.FullName] = base.ID
	}
}

func (b *builder) walkFile(fd protoreflect.FileDescriptor) error {
	fileName := string(fd.Path())
	pkgName := string(fd.Package())
	class := classify.File(fileName, pkgName, b.options.Classification)
	loc := locationFor(fd, fd)
	hasSource := b.options.SourceTexts[fileName] != ""
	path, _ := urlPathFor("file", fileName, "")
	syntax, edition := fileSyntax(fd)
	fopts, _ := fd.Options().(*descriptorpb.FileOptions)
	doc := &DocFile{
		baseSymbol: newBase("file", fileName, shortName(fileName), pkgName, fileName, string(class.Domain), false, false, fopts != nil && fopts.GetDeprecated()),
		Syntax:     syntax,
	}
	doc.GeneratePage = class.GeneratePage && hasSource
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(fd.Options(), "file")
	doc.URLPath = path
	doc.Features = []EffectiveFeature{}
	if syntax == "editions" {
		doc.Edition = edition
	}
	for i := 0; i < fd.Imports().Len(); i++ {
		imp := fd.Imports().Get(i)
		id := symbolID("file", imp.Path())
		doc.DependencyIDs = append(doc.DependencyIDs, id)
		if imp.IsPublic {
			doc.PublicDependencyIDs = append(doc.PublicDependencyIDs, id)
		}
		b.addRef("file-import", doc.ID, id, "")
	}
	if doc.DependencyIDs == nil {
		doc.DependencyIDs = []string{}
	}
	if doc.PublicDependencyIDs == nil {
		doc.PublicDependencyIDs = []string{}
	}
	if fopts != nil {
		doc.GoPackage = fopts.GetGoPackage()
		doc.JavaPackage = fopts.GetJavaPackage()
		doc.CsharpNamespace = fopts.GetCsharpNamespace()
	}
	if hasSource {
		doc.SourceText = b.options.SourceTexts[fileName]
	}
	b.files = append(b.files, doc)
	b.remember(doc, &doc.baseSymbol)
	pkg := b.ensurePackage(pkgName, class, doc.Comments)
	pkg.FileIDs = append(pkg.FileIDs, doc.ID)

	for i := 0; i < fd.Messages().Len(); i++ {
		b.walkMessage(fd.Messages().Get(i), nil, class, fileName, pkgName, hasSource)
	}
	for i := 0; i < fd.Enums().Len(); i++ {
		b.walkEnum(fd.Enums().Get(i), nil, class, fileName, pkgName, hasSource)
	}
	for i := 0; i < fd.Extensions().Len(); i++ {
		b.walkExtension(fd.Extensions().Get(i), class, fileName, pkgName, hasSource)
	}
	for i := 0; i < fd.Services().Len(); i++ {
		b.walkService(fd.Services().Get(i), class, fileName, pkgName, hasSource)
	}
	return nil
}

func (b *builder) ensurePackage(packageName string, class classify.Result, comments *DocComment) *DocPackage {
	if existing, ok := b.packages[packageName]; ok {
		if class.GeneratePage {
			existing.GeneratePage = true
		}
		if class.InNav {
			existing.InNav = true
		}
		if class.Domain == classify.DomainLocal {
			existing.Domain = string(classify.DomainLocal)
		}
		return existing
	}
	name := packageName
	if name == "" {
		name = "(unnamed)"
	}
	path, _ := urlPathFor("package", name, "")
	doc := &DocPackage{baseSymbol: newBase("package", name, name, name, "", string(class.Domain), class.GeneratePage, class.InNav, false)}
	doc.Comments = comments
	doc.URLPath = path
	doc.ServiceIDs = []string{}
	doc.MessageIDs = []string{}
	doc.EnumIDs = []string{}
	doc.ExtensionIDs = []string{}
	doc.FileIDs = []string{}
	b.packages[packageName] = doc
	b.remember(doc, &doc.baseSymbol)
	return doc
}

func (b *builder) walkMessage(md protoreflect.MessageDescriptor, parent protoreflect.MessageDescriptor, class classify.Result, fileName, pkgName string, hasSource bool) {
	if md.IsMapEntry() {
		return
	}
	full := string(md.FullName())
	loc := locationFor(md.ParentFile(), md)
	path, _ := urlPathFor("message", full, "")
	doc := &DocMessage{baseSymbol: newBase("message", full, string(md.Name()), pkgName, fileName, string(class.Domain), class.GeneratePage, class.InNav && parent == nil, deprecatedMessage(md))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(md.Options(), "message")
	doc.URLPath = path
	doc.Features = messageFeatures(md)
	if parent != nil {
		doc.ParentID = symbolID("message", string(parent.FullName()))
		b.addRef("nested-type", doc.ParentID, doc.ID, "")
	}
	doc.FieldIDs = []string{}
	doc.OneofIDs = []string{}
	doc.NestedMessageIDs = []string{}
	doc.NestedEnumIDs = []string{}
	doc.NestedExtensionIDs = []string{}
	doc.ExtensionRanges = fieldRanges(md.ExtensionRanges())
	doc.ReservedRanges = fieldRanges(md.ReservedRanges())
	doc.ReservedNames = nameList(md.ReservedNames())
	b.messages = append(b.messages, doc)
	b.remember(doc, &doc.baseSymbol)
	b.packages[pkgName].MessageIDs = append(b.packages[pkgName].MessageIDs, doc.ID)

	for i := 0; i < md.Oneofs().Len(); i++ {
		od := md.Oneofs().Get(i)
		if od.IsSynthetic() {
			continue
		}
		b.walkOneof(od, doc, class, fileName, pkgName)
	}
	for i := 0; i < md.Fields().Len(); i++ {
		b.walkField(md.Fields().Get(i), doc, class, fileName, pkgName, hasSource)
	}
	for i := 0; i < md.Messages().Len(); i++ {
		nested := md.Messages().Get(i)
		b.walkMessage(nested, md, class, fileName, pkgName, hasSource)
		if !nested.IsMapEntry() {
			doc.NestedMessageIDs = append(doc.NestedMessageIDs, symbolID("message", string(nested.FullName())))
		}
	}
	for i := 0; i < md.Enums().Len(); i++ {
		nested := md.Enums().Get(i)
		b.walkEnum(nested, md, class, fileName, pkgName, hasSource)
		doc.NestedEnumIDs = append(doc.NestedEnumIDs, symbolID("enum", string(nested.FullName())))
	}
	for i := 0; i < md.Extensions().Len(); i++ {
		ext := md.Extensions().Get(i)
		b.walkExtension(ext, class, fileName, pkgName, hasSource)
		doc.NestedExtensionIDs = append(doc.NestedExtensionIDs, symbolID("extension", string(ext.FullName())))
	}
}

func (b *builder) walkOneof(od protoreflect.OneofDescriptor, parent *DocMessage, class classify.Result, fileName, pkgName string) {
	full := parent.FullName + "." + string(od.Name())
	loc := locationFor(od.ParentFile(), od)
	path, anchor := urlPathFor("oneof", full, parent.FullName)
	doc := &DocOneof{baseSymbol: newBase("oneof", full, string(od.Name()), pkgName, fileName, string(class.Domain), false, false, false)}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.Options = b.optionsOf(od.Options(), "oneof")
	doc.URLPath = path
	doc.Anchor = anchor
	doc.ParentID = parent.ID
	doc.FieldIDs = []string{}
	b.oneofs = append(b.oneofs, doc)
	b.remember(doc, &doc.baseSymbol)
	parent.OneofIDs = append(parent.OneofIDs, doc.ID)
}

func (b *builder) walkField(fd protoreflect.FieldDescriptor, parent *DocMessage, class classify.Result, fileName, pkgName string, hasSource bool) {
	full := parent.FullName + "." + string(fd.Name())
	loc := locationFor(fd.ParentFile(), fd)
	path, anchor := urlPathFor("field", full, parent.FullName)
	doc := &DocField{baseSymbol: newBase("field", full, string(fd.Name()), pkgName, fileName, string(class.Domain), false, false, deprecatedField(fd))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(fd.Options(), "field")
	doc.URLPath = path
	doc.Anchor = anchor
	doc.Features = fieldFeatures(fd, parent.FullName)
	doc.ParentID = parent.ID
	doc.Number = int32(fd.Number())
	doc.JSONName = fd.JSONName()
	doc.Cardinality = cardinalityOf(fd)
	doc.Type = b.typeRef(fd, string(class.Domain))
	if fd.IsMap() {
		key := scalarTypeRef(fd.MapKey().Kind())
		doc.MapKey = &key
		val := b.descriptorTypeRef(fd.MapValue(), string(class.Domain))
		doc.MapValue = &val
	}
	if od := fd.ContainingOneof(); od != nil && !od.IsSynthetic() {
		doc.OneofID = symbolID("oneof", parent.FullName+"."+string(od.Name()))
	}
	if fd.IsList() {
		packed := fd.IsPacked()
		doc.Packed = &packed
	}
	doc.DefaultValue = defaultValue(fd)
	doc.Presence = presenceOf(fd)
	b.fields = append(b.fields, doc)
	b.remember(doc, &doc.baseSymbol)
	parent.FieldIDs = append(parent.FieldIDs, doc.ID)
	if doc.OneofID != "" {
		for _, oneof := range b.oneofs {
			if oneof.ID == doc.OneofID {
				oneof.FieldIDs = append(oneof.FieldIDs, doc.ID)
			}
		}
	}
	b.linkType(doc.ID, doc.Type, "field-type")
	if doc.MapKey != nil {
		b.linkType(doc.ID, *doc.MapKey, "map-key-type")
	}
	if doc.MapValue != nil {
		b.linkType(doc.ID, *doc.MapValue, "map-value-type")
	}
	for _, option := range doc.Options {
		if option.DefinitionID != "" {
			b.addRef("option-definition", doc.ID, option.DefinitionID, option.FullName)
		}
	}
}

func (b *builder) walkEnum(ed protoreflect.EnumDescriptor, parent protoreflect.MessageDescriptor, class classify.Result, fileName, pkgName string, hasSource bool) {
	full := string(ed.FullName())
	loc := locationFor(ed.ParentFile(), ed)
	path, _ := urlPathFor("enum", full, "")
	opts, _ := ed.Options().(*descriptorpb.EnumOptions)
	doc := &DocEnum{baseSymbol: newBase("enum", full, string(ed.Name()), pkgName, fileName, string(class.Domain), class.GeneratePage, class.InNav && parent == nil, deprecatedEnum(ed))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(ed.Options(), "enum")
	doc.URLPath = path
	doc.Features = enumFeatures(ed)
	if parent != nil {
		doc.ParentID = symbolID("message", string(parent.FullName()))
		b.addRef("nested-type", doc.ParentID, doc.ID, "")
	}
	doc.Open = enumOpen(ed)
	if opts != nil {
		doc.AllowAlias = opts.GetAllowAlias()
	}
	doc.ValueIDs = []string{}
	doc.ReservedRanges = enumRangeList(ed.ReservedRanges())
	doc.ReservedNames = nameList(ed.ReservedNames())
	b.enums = append(b.enums, doc)
	b.remember(doc, &doc.baseSymbol)
	b.packages[pkgName].EnumIDs = append(b.packages[pkgName].EnumIDs, doc.ID)
	for i := 0; i < ed.Values().Len(); i++ {
		b.walkEnumValue(ed.Values().Get(i), doc, class, fileName, pkgName)
	}
}

func (b *builder) walkEnumValue(vd protoreflect.EnumValueDescriptor, parent *DocEnum, class classify.Result, fileName, pkgName string) {
	full := parent.FullName + "." + string(vd.Name())
	loc := locationFor(vd.ParentFile(), vd)
	path, anchor := urlPathFor("enum-value", full, parent.FullName)
	doc := &DocEnumValue{baseSymbol: newBase("enum-value", full, string(vd.Name()), pkgName, fileName, string(class.Domain), false, false, deprecatedEnumValue(vd))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.Options = b.optionsOf(vd.Options(), "enum-value")
	doc.URLPath = path
	doc.Anchor = anchor
	doc.ParentID = parent.ID
	doc.Number = int32(vd.Number())
	b.values = append(b.values, doc)
	b.remember(doc, &doc.baseSymbol)
	parent.ValueIDs = append(parent.ValueIDs, doc.ID)
	for _, option := range doc.Options {
		if option.DefinitionID != "" {
			b.addRef("option-definition", doc.ID, option.DefinitionID, option.FullName)
		}
	}
}

func (b *builder) walkExtension(ext protoreflect.ExtensionDescriptor, class classify.Result, fileName, pkgName string, hasSource bool) {
	full := string(ext.FullName())
	loc := locationFor(ext.ParentFile(), ext)
	path, _ := urlPathFor("extension", full, "")
	target := optionTargetOf(ext.ContainingMessage().FullName())
	page := (class.GeneratePage || target != "") && !classify.Excluded(fileName, pkgName, b.options.Classification.Exclude)
	doc := &DocExtension{baseSymbol: newBase("extension", full, string(ext.Name()), pkgName, fileName, string(class.Domain), page, class.InNav, deprecatedField(ext))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(ext.Options(), "field")
	doc.URLPath = path
	doc.Features = extensionFeatures(ext)
	doc.Number = int32(ext.Number())
	extendeeName := string(ext.ContainingMessage().FullName())
	doc.Extendee = TypeRef{Kind: "message", Name: extendeeName, ID: symbolID("message", extendeeName)}
	doc.Type = b.descriptorTypeRef(ext, string(class.Domain))
	doc.OptionTarget = target
	typeName := doc.Type.Name
	if ext.IsList() {
		typeName = "repeated " + typeName
	}
	doc.Declaration = fmt.Sprintf("extend %s {\n  %s %s = %d;\n}", extendeeName, typeName, ext.Name(), ext.Number())
	b.exts = append(b.exts, doc)
	b.remember(doc, &doc.baseSymbol)
	b.packages[pkgName].ExtensionIDs = append(b.packages[pkgName].ExtensionIDs, doc.ID)
	b.addRef("extension-target", doc.ID, doc.Extendee.ID, "extends")
	b.linkType(doc.ID, doc.Type, "field-type")
}

func (b *builder) walkService(sd protoreflect.ServiceDescriptor, class classify.Result, fileName, pkgName string, hasSource bool) {
	full := string(sd.FullName())
	loc := locationFor(sd.ParentFile(), sd)
	path, _ := urlPathFor("service", full, "")
	doc := &DocService{baseSymbol: newBase("service", full, string(sd.Name()), pkgName, fileName, string(class.Domain), class.GeneratePage, class.InNav, deprecatedService(sd))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(sd.Options(), "service")
	doc.URLPath = path
	doc.MethodIDs = []string{}
	b.services = append(b.services, doc)
	b.remember(doc, &doc.baseSymbol)
	b.packages[pkgName].ServiceIDs = append(b.packages[pkgName].ServiceIDs, doc.ID)
	for i := 0; i < sd.Methods().Len(); i++ {
		b.walkMethod(sd.Methods().Get(i), doc, class, fileName, pkgName, hasSource)
	}
}

func (b *builder) walkMethod(md protoreflect.MethodDescriptor, parent *DocService, class classify.Result, fileName, pkgName string, hasSource bool) {
	full := parent.FullName + "." + string(md.Name())
	loc := locationFor(md.ParentFile(), md)
	path, anchor := urlPathFor("method", full, parent.FullName)
	doc := &DocMethod{baseSymbol: newBase("method", full, string(md.Name()), pkgName, fileName, string(class.Domain), class.GeneratePage, false, deprecatedMethod(md))}
	doc.Comments = commentFrom(loc)
	doc.Source = sourceFrom(fileName, loc)
	doc.SourceLink, doc.RepositoryLink = sourceRefs(fileName, lineOf(doc.Source), b.options.Source, hasSource)
	doc.Options = b.optionsOf(md.Options(), "method")
	doc.URLPath = path
	doc.Anchor = anchor
	doc.ParentID = parent.ID
	doc.Input = b.namedRef("message", string(md.Input().FullName()))
	doc.Output = b.namedRef("message", string(md.Output().FullName()))
	doc.ClientStreaming = md.IsStreamingClient()
	doc.ServerStreaming = md.IsStreamingServer()
	switch {
	case doc.ClientStreaming && doc.ServerStreaming:
		doc.StreamingKind = "bidi_streaming"
	case doc.ClientStreaming:
		doc.StreamingKind = "client_streaming"
	case doc.ServerStreaming:
		doc.StreamingKind = "server_streaming"
	default:
		doc.StreamingKind = "unary"
	}
	doc.Idempotency = idempotency(md)
	in := string(md.Input().Name())
	out := string(md.Output().Name())
	if doc.ClientStreaming {
		in = "stream " + in
	}
	if doc.ServerStreaming {
		out = "stream " + out
	}
	doc.Signature = fmt.Sprintf("rpc %s(%s) returns (%s);", md.Name(), in, out)
	b.methods = append(b.methods, doc)
	b.remember(doc, &doc.baseSymbol)
	parent.MethodIDs = append(parent.MethodIDs, doc.ID)
	b.addRef("rpc-input", doc.ID, doc.Input.ID, "request")
	b.addRef("rpc-output", doc.ID, doc.Output.ID, "response")
	for _, option := range doc.Options {
		if option.DefinitionID != "" {
			b.addRef("option-definition", doc.ID, option.DefinitionID, option.FullName)
		}
	}
}

func (b *builder) typeRef(fd protoreflect.FieldDescriptor, domain string) TypeRef {
	switch {
	case fd.IsMap():
		return b.descriptorTypeRef(fd.MapValue(), domain)
	case fd.IsList():
		return b.descriptorTypeRef(fd, domain)
	default:
		return b.descriptorTypeRef(fd, domain)
	}
}

func (b *builder) descriptorTypeRef(fd protoreflect.FieldDescriptor, domain string) TypeRef {
	switch fd.Kind() {
	case protoreflect.EnumKind:
		return b.namedRef("enum", string(fd.Enum().FullName()))
	case protoreflect.MessageKind, protoreflect.GroupKind:
		if fd.IsMap() {
			return b.descriptorTypeRef(fd.MapValue(), domain)
		}
		return b.namedRef("message", string(fd.Message().FullName()))
	default:
		return scalarTypeRef(fd.Kind())
	}
}

func scalarTypeRef(kind protoreflect.Kind) TypeRef {
	return TypeRef{Kind: "scalar", Name: scalarName(kind)}
}

func (b *builder) namedRef(kind, typeName string) TypeRef {
	path, _ := urlPathFor(kind, typeName, "")
	ref := TypeRef{Kind: kind, Name: typeName, ID: symbolID(kind, typeName), URLPath: path}
	if external := classify.ExternalURL(typeName, kind, b.options.Classification); external != "" {
		ref.URLPath = ""
		ref.ExternalURL = external
	}
	return ref
}

func (b *builder) linkType(from string, ref TypeRef, kind string) {
	if ref.ID != "" {
		b.addRef(kind, from, ref.ID, "")
	}
}

func (b *builder) addRef(kind, from, to, label string) {
	if from == "" || to == "" {
		return
	}
	b.forward = append(b.forward, SymbolReference{Kind: kind, FromID: from, ToID: to, Label: label})
}

func (b *builder) finish() *SchemaModel {
	packages := make([]*DocPackage, 0, len(b.packages))
	for _, pkg := range b.packages {
		packages = append(packages, pkg)
	}
	sort.Slice(packages, func(i, j int) bool { return packages[i].FullName < packages[j].FullName })
	sortByName(b.files)
	sortByNameMsg(b.messages)
	sortByNameField(b.fields)
	sortByNameOneof(b.oneofs)
	sortByNameEnum(b.enums)
	sortByNameValue(b.values)
	sortByNameSvc(b.services)
	sortByNameMethod(b.methods)
	sortByNameExt(b.exts)

	model := &SchemaModel{
		Title:      b.options.Title,
		Packages:   packages,
		Files:      b.files,
		Messages:   b.messages,
		Fields:     b.fields,
		Oneofs:     b.oneofs,
		Enums:      b.enums,
		EnumValues: b.values,
		Services:   b.services,
		Methods:    b.methods,
		Extensions: b.exts,
		Symbols:    b.symbols,
		ByFullName: b.byFullName,
		BuildInfo: BuildInfo{
			Title:       b.options.Title,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Generator:   "pbschema-lens",
			Input:       b.options.InputLabel,
			Commit:      b.options.Commit,
			Repository:  repoOf(b.options.Source),
			FileCount:   len(b.files),
			Timings:     map[string]int{},
			Warnings:    append([]string{}, b.options.Warnings...),
		},
		WKTNotes: wktNotes(),
	}
	if model.BuildInfo.Warnings == nil {
		model.BuildInfo.Warnings = []string{}
	}
	excluded := excludedIDs(model, b.options.Classification.Exclude)
	for _, file := range model.Files {
		if excluded[file.ID] {
			file.DependencyIDs = []string{}
			file.SourceText = ""
			file.GeneratePage = false
		} else {
			kept := file.DependencyIDs[:0]
			for _, id := range file.DependencyIDs {
				if !excluded[id] {
					kept = append(kept, id)
				}
			}
			if kept == nil {
				kept = []string{}
			}
			file.DependencyIDs = kept
		}
		if !b.options.Classification.WellKnownTypes && file.Domain == string(classify.DomainWellKnown) {
			file.SourceText = ""
			file.GeneratePage = false
		}
	}
	for _, symbol := range allBases(model) {
		for _, option := range symbol.Options {
			if option.DefinitionID != "" && excluded[option.DefinitionID] {
				option.DefinitionID = ""
			}
		}
	}
	var visible []SymbolReference
	for _, ref := range b.forward {
		if excluded[ref.FromID] || excluded[ref.ToID] {
			continue
		}
		visible = append(visible, ref)
	}
	attachReferences(model, visible)
	for _, message := range model.Messages {
		if !message.MapEntry && message.GeneratePage {
			message.ExampleJSON = exampleJSON(message, model, 0)
			message.ExampleTextProto = exampleText(message, model)
		}
	}
	promotePages(model, excluded)
	model.SymbolIndex = indexFor(model, excluded)
	model.BuildInfo.SymbolCount = len(model.Symbols)
	ensureLists(model)
	return model
}

// ensureLists makes empty collections JSON arrays. A nil slice marshals as null
// and the browser calls array methods on these fields.
func ensureLists(model *SchemaModel) {
	if model.Packages == nil {
		model.Packages = []*DocPackage{}
	}
	if model.Files == nil {
		model.Files = []*DocFile{}
	}
	if model.Messages == nil {
		model.Messages = []*DocMessage{}
	}
	if model.Fields == nil {
		model.Fields = []*DocField{}
	}
	if model.Oneofs == nil {
		model.Oneofs = []*DocOneof{}
	}
	if model.Enums == nil {
		model.Enums = []*DocEnum{}
	}
	if model.EnumValues == nil {
		model.EnumValues = []*DocEnumValue{}
	}
	if model.Services == nil {
		model.Services = []*DocService{}
	}
	if model.Methods == nil {
		model.Methods = []*DocMethod{}
	}
	if model.Extensions == nil {
		model.Extensions = []*DocExtension{}
	}
	if model.SymbolIndex == nil {
		model.SymbolIndex = []SymbolIndexEntry{}
	}
	if model.ByFullName == nil {
		model.ByFullName = map[string]string{}
	}
	if model.WKTNotes == nil {
		model.WKTNotes = map[string]string{}
	}
}

func newBase(kind, full, short, pkg, file, domain string, page, nav, deprecated bool) baseSymbol {
	return baseSymbol{
		ID:           symbolID(kind, full),
		Kind:         kind,
		FullName:     full,
		ShortName:    short,
		PackageName:  pkg,
		FileName:     file,
		Domain:       domain,
		GeneratePage: page,
		InNav:        nav,
		Deprecated:   deprecated,
		Options:      []*DocOption{},
		References:   []SymbolReference{},
		ReferencedBy: []SymbolReference{},
		Features:     []EffectiveFeature{},
	}
}

func locationFor(file protoreflect.FileDescriptor, desc protoreflect.Descriptor) protoreflect.SourceLocation {
	if file == nil {
		return protoreflect.SourceLocation{}
	}
	return file.SourceLocations().ByDescriptor(desc)
}

func commentFrom(loc protoreflect.SourceLocation) *DocComment {
	if len(loc.Path) == 0 && loc.LeadingComments == "" && loc.TrailingComments == "" && len(loc.LeadingDetachedComments) == 0 {
		return nil
	}
	leading := normalizeComment(loc.LeadingComments)
	trailing := normalizeComment(loc.TrailingComments)
	var detached []string
	for _, item := range loc.LeadingDetachedComments {
		if text := normalizeComment(item); text != "" {
			detached = append(detached, text)
		}
	}
	if leading == "" && trailing == "" && len(detached) == 0 {
		return nil
	}
	if detached == nil {
		detached = []string{}
	}
	return &DocComment{
		Leading:      leading,
		Trailing:     trailing,
		Detached:     detached,
		MarkdownHTML: markdown.RenderSafe(markdown.CommentsToMarkdown(strings.Join(detached, "\n\n"), leading, trailing)),
	}
}

func normalizeComment(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = starLine.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

func sourceFrom(fileName string, loc protoreflect.SourceLocation) *SourceLocation {
	if len(loc.Path) == 0 && loc.LeadingComments == "" && loc.EndLine == 0 && loc.EndColumn == 0 && loc.StartColumn == 0 && loc.StartLine == 0 {
		return nil
	}
	return &SourceLocation{
		FileName:    fileName,
		StartLine:   loc.StartLine + 1,
		StartColumn: loc.StartColumn + 1,
		EndLine:     loc.EndLine + 1,
		EndColumn:   loc.EndColumn + 1,
	}
}

func lineOf(src *SourceLocation) int {
	if src == nil {
		return 1
	}
	return src.StartLine
}

func fileSyntax(fd protoreflect.FileDescriptor) (syntax, edition string) {
	switch fd.Syntax() {
	case protoreflect.Proto2:
		return "proto2", ""
	case protoreflect.Editions:
		return "editions", editionName(fd)
	default:
		return "proto3", ""
	}
}

func editionName(fd protoreflect.FileDescriptor) string {
	// protoreflect.FileDescriptor.Edition exists on recent protobuf modules.
	type editioner interface{ Edition() int32 }
	if e, ok := any(fd).(editioner); ok {
		switch e.Edition() {
		case 998:
			return "proto2"
		case 999:
			return "proto3"
		case 1000:
			return "2023"
		case 1001:
			return "2024"
		default:
			if e.Edition() != 0 {
				return fmt.Sprint(e.Edition())
			}
		}
	}
	return "editions"
}

func cardinalityOf(fd protoreflect.FieldDescriptor) string {
	switch {
	case fd.IsMap():
		return "map"
	case fd.IsList():
		return "repeated"
	case fd.Cardinality() == protoreflect.Required:
		return "required"
	case fd.HasOptionalKeyword() || fd.Syntax() == protoreflect.Proto2:
		return "optional"
	default:
		return "implicit"
	}
}

func presenceOf(fd protoreflect.FieldDescriptor) string {
	switch {
	case fd.Cardinality() == protoreflect.Required:
		return "LEGACY_REQUIRED"
	case fd.HasPresence():
		return "EXPLICIT"
	default:
		return "IMPLICIT"
	}
}

func defaultValue(fd protoreflect.FieldDescriptor) string {
	if !fd.HasDefault() || fd.IsList() || fd.IsMap() {
		return ""
	}
	switch fd.Kind() {
	case protoreflect.EnumKind:
		if ev := fd.DefaultEnumValue(); ev != nil {
			return string(ev.Name())
		}
	case protoreflect.BytesKind:
		return fmt.Sprintf("<%d bytes>", len(fd.Default().Bytes()))
	case protoreflect.StringKind:
		return fd.Default().String()
	case protoreflect.BoolKind:
		if fd.Default().Bool() {
			return "true"
		}
		return "false"
	default:
		return fd.Default().String()
	}
	return ""
}

func deprecatedMessage(md protoreflect.MessageDescriptor) bool {
	opts, _ := md.Options().(*descriptorpb.MessageOptions)
	return opts != nil && opts.GetDeprecated()
}
func deprecatedField(fd protoreflect.FieldDescriptor) bool {
	opts, _ := fd.Options().(*descriptorpb.FieldOptions)
	return opts != nil && opts.GetDeprecated()
}
func deprecatedEnum(ed protoreflect.EnumDescriptor) bool {
	opts, _ := ed.Options().(*descriptorpb.EnumOptions)
	return opts != nil && opts.GetDeprecated()
}
func deprecatedEnumValue(vd protoreflect.EnumValueDescriptor) bool {
	opts, _ := vd.Options().(*descriptorpb.EnumValueOptions)
	return opts != nil && opts.GetDeprecated()
}
func deprecatedService(sd protoreflect.ServiceDescriptor) bool {
	opts, _ := sd.Options().(*descriptorpb.ServiceOptions)
	return opts != nil && opts.GetDeprecated()
}
func deprecatedMethod(md protoreflect.MethodDescriptor) bool {
	opts, _ := md.Options().(*descriptorpb.MethodOptions)
	return opts != nil && opts.GetDeprecated()
}

func idempotency(md protoreflect.MethodDescriptor) string {
	opts, _ := md.Options().(*descriptorpb.MethodOptions)
	if opts == nil {
		return ""
	}
	switch opts.GetIdempotencyLevel() {
	case descriptorpb.MethodOptions_NO_SIDE_EFFECTS:
		return "NO_SIDE_EFFECTS"
	case descriptorpb.MethodOptions_IDEMPOTENT:
		return "IDEMPOTENT"
	default:
		return ""
	}
}

func repoOf(config *SourceConfig) string {
	if config == nil {
		return ""
	}
	return config.Repository
}
