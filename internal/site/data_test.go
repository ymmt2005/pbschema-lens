package site

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymmt2005/pbschema-lens/internal/model"
)

func TestWriteModelSplitsPayloads(t *testing.T) {
	field := &model.DocField{}
	field.ID = "field:demo.M.a"
	field.Kind = "field"
	field.FullName = "demo.M.a"
	field.ShortName = "a"
	field.JSONName = "a"
	field.Presence = "EXPLICIT"
	field.Options = []*model.DocOption{}
	field.References = []model.SymbolReference{}
	field.ReferencedBy = []model.SymbolReference{}
	field.Features = []model.EffectiveFeature{}

	msg := &model.DocMessage{}
	msg.ID = "message:demo.M"
	msg.Kind = "message"
	msg.FullName = "demo.M"
	msg.ShortName = "M"
	msg.PackageName = "demo"
	msg.GeneratePage = true
	msg.URLPath = "/reference/messages/demo.M/"
	msg.FieldIDs = []string{field.ID}
	msg.OneofIDs = []string{}
	msg.NestedMessageIDs = []string{}
	msg.NestedEnumIDs = []string{}
	msg.NestedExtensionIDs = []string{}
	msg.Options = []*model.DocOption{}
	msg.References = []model.SymbolReference{}
	msg.ReferencedBy = []model.SymbolReference{}
	msg.Features = []model.EffectiveFeature{{Name: "field_presence", Effective: "EXPLICIT", Source: "edition-default"}}
	msg.Comments = &model.DocComment{Leading: "widget", Detached: []string{"DETACHED_NOTE"}}

	file := &model.DocFile{}
	file.ID = "file:demo.proto"
	file.Kind = "file"
	file.FullName = "demo.proto"
	file.PackageName = "demo"
	file.GeneratePage = true
	file.URLPath = "/source/demo.proto/"
	file.Syntax = "proto3"
	file.SourceText = "SECRET_SOURCE"
	file.DependencyIDs = []string{}
	file.PublicDependencyIDs = []string{}
	file.Options = []*model.DocOption{}
	file.References = []model.SymbolReference{}
	file.ReferencedBy = []model.SymbolReference{}
	file.Features = []model.EffectiveFeature{}

	pkg := &model.DocPackage{}
	pkg.ID = "package:demo"
	pkg.Kind = "package"
	pkg.FullName = "demo"
	pkg.PackageName = "demo"
	pkg.GeneratePage = true
	pkg.InNav = true
	pkg.Domain = "local"
	pkg.URLPath = "/reference/packages/demo/"
	pkg.ServiceIDs = []string{}
	pkg.MessageIDs = []string{msg.ID}
	pkg.EnumIDs = []string{}
	pkg.ExtensionIDs = []string{}
	pkg.FileIDs = []string{file.ID}
	pkg.Options = []*model.DocOption{}
	pkg.References = []model.SymbolReference{}
	pkg.ReferencedBy = []model.SymbolReference{}
	pkg.Features = []model.EffectiveFeature{}

	schema := &model.SchemaModel{
		Title:    "Demo",
		Packages: []*model.DocPackage{pkg},
		Files:    []*model.DocFile{file},
		Messages: []*model.DocMessage{msg},
		Fields:   []*model.DocField{field},
		Symbols: map[string]any{
			pkg.ID: pkg, file.ID: file, msg.ID: msg, field.ID: field,
		},
		SymbolIndex: []model.SymbolIndexEntry{
			{ID: msg.ID, Name: "M", FullName: "demo.M", Kind: "message", Package: "demo", URLPath: msg.URLPath},
		},
		WKTNotes:  map[string]string{},
		BuildInfo: model.BuildInfo{SymbolCount: 1, FileCount: 1, Warnings: []string{}, Timings: map[string]int{}},
		Diff:      &model.SchemaDiff{AgainstLabel: "SECRET_DIFF", Added: []model.SymbolChange{}, Removed: []model.SymbolChange{}, Modified: []model.SymbolChange{}},
	}
	dir := t.TempDir()
	if err := writeModel(dir, schema, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "model.json")); err == nil {
		t.Fatal("monolithic model.json was written")
	}
	indexRaw, err := os.ReadFile(filepath.Join(dir, "assets", "model", "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(indexRaw), "SECRET_SOURCE") || strings.Contains(string(indexRaw), "SECRET_DIFF") {
		t.Fatal("index.json contains source text or the diff payload")
	}
	var index siteIndex
	if err := json.Unmarshal(indexRaw, &index); err != nil {
		t.Fatal(err)
	}
	if len(index.Files) != 1 || !index.HasSource || index.Files[0].FullName != "demo.proto" {
		t.Fatalf("files %+v", index.Files)
	}
	if !index.HasDiff || len(index.SymbolIndex) != 1 || len(index.SymbolIndex[0].Shard) != 64 || index.Files[0].SourceShard == "" {
		t.Fatalf("index shards %+v file %+v", index.SymbolIndex, index.Files)
	}
	if len(index.Files[0].SourceShard) != 64 {
		t.Fatalf("source shard %q", index.Files[0].SourceShard)
	}
	symbolRaw, err := os.ReadFile(filepath.Join(dir, "assets", "model", "symbols", index.SymbolIndex[0].Shard+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(symbolRaw), `"jsonName":"a"`) || !strings.Contains(string(symbolRaw), "field_presence") {
		t.Fatalf("symbol payload %s", symbolRaw)
	}
	sourceRaw, err := os.ReadFile(filepath.Join(dir, "assets", "model", "source", index.Files[0].SourceShard+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(sourceRaw), "SECRET_SOURCE") {
		t.Fatalf("source payload %s", sourceRaw)
	}
	if _, err := os.Stat(filepath.Join(dir, "assets", "model", "graph.json")); err != nil {
		t.Fatal(err)
	}
	commentRaw, err := os.ReadFile(filepath.Join(dir, "assets", "model", "comments.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(commentRaw), "DETACHED_NOTE") || strings.Index(string(commentRaw), "DETACHED_NOTE") > strings.Index(string(commentRaw), "widget") {
		t.Fatalf("comments %s", commentRaw)
	}
	diffRaw, err := os.ReadFile(filepath.Join(dir, "assets", "model", "diff.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(diffRaw), "SECRET_DIFF") {
		t.Fatalf("diff %s", diffRaw)
	}
	if _, err := os.Stat(filepath.Join(dir, "assets", "model", "references.json")); err != nil {
		t.Fatal(err)
	}
}

func TestIndexKeepsPackagesWithoutPages(t *testing.T) {
	hidden := &model.DocPackage{}
	hidden.ID = "package:buf.validate"
	hidden.Kind = "package"
	hidden.FullName = "buf.validate"
	hidden.Domain = "external-undocumented"
	shown := &model.DocPackage{}
	shown.ID = "package:acme"
	shown.Kind = "package"
	shown.FullName = "acme"
	shown.GeneratePage = true
	shown.InNav = true
	shown.Domain = "local"
	schema := &model.SchemaModel{
		Packages:    []*model.DocPackage{hidden, shown},
		Symbols:     map[string]any{},
		SymbolIndex: []model.SymbolIndexEntry{},
		WKTNotes:    map[string]string{},
		BuildInfo:   model.BuildInfo{Warnings: []string{}, Timings: map[string]int{}},
	}
	index := buildIndex(schema)
	if len(index.Packages) != 2 || index.Packages[0].FullName != "buf.validate" {
		t.Fatalf("packages %+v", index.Packages)
	}
}

func TestWriteModelSkipsCommentsWhenFullTextIsOff(t *testing.T) {
	dir := t.TempDir()
	schema := &model.SchemaModel{
		Symbols:     map[string]any{},
		SymbolIndex: []model.SymbolIndexEntry{},
		WKTNotes:    map[string]string{},
		BuildInfo:   model.BuildInfo{Warnings: []string{}, Timings: map[string]int{}},
	}
	if err := writeModel(dir, schema, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "assets", "model", "comments.json")); err == nil {
		t.Fatal("comments.json was written with full-text search disabled")
	}
	if _, err := os.Stat(filepath.Join(dir, "assets", "model", "references.json")); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareOutputRefusesCheckoutAndRoot(t *testing.T) {
	for _, path := range []string{"", ".", "./", "/", ".."} {
		if _, err := prepareOutput(path); err == nil {
			t.Fatalf("accepted %q", path)
		}
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := prepareOutput(cwd); err == nil {
		t.Fatal("accepted the working directory")
	}
	parent := filepath.Dir(cwd)
	if parent != cwd {
		if _, err := prepareOutput(parent); err == nil {
			t.Fatal("accepted an ancestor of the working directory")
		}
	}
	sub := t.TempDir()
	nested := filepath.Join(sub, "dist", "site")
	got, err := prepareOutput(nested)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(got); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareOutputRemovesDirectorySymlink(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real")
	if err := os.Mkdir(real, 0o755); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(real, "keep.txt")
	if err := os.WriteFile(keep, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "out")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareOutput(link); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("RemoveAll walked through the directory symlink")
	}
	info, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		t.Fatal("output path is still a symlink")
	}
}

func TestWriteFileRejectsEscape(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(filepath.Dir(dir), "escape.txt")
	absOutside := filepath.Join(filepath.Dir(dir), "abs-escape.txt")
	for _, name := range []string{
		"../escape.txt",
		"foo/../../escape.txt",
		filepath.Join("foo", "..", "..", "escape.txt"),
		absOutside,
	} {
		if err := writeFile(dir, name, []byte("nope")); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
	for _, path := range []string{outside, absOutside} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("wrote outside the output directory: %s (%v)", path, err)
		}
	}
	if err := writeFile(dir, filepath.Join("assets", "ok.txt"), []byte("yes")); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "assets", "ok.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "yes" {
		t.Fatalf("payload %q", raw)
	}
}

func TestWriteKeepsOutputWhenBaseIsInvalid(t *testing.T) {
	dir := t.TempDir()
	keep := filepath.Join(dir, "keep.txt")
	if err := os.WriteFile(keep, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Write(dir, &model.SchemaModel{}, Options{Base: `/"><script>`})
	if err == nil {
		t.Fatal("expected base rejection")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("output was removed before base validation")
	}
}
