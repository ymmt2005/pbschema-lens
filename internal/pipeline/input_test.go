package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestBuildUsesConfigInput(t *testing.T) {
	dir := t.TempDir()
	set := &descriptorpb.FileDescriptorSet{File: []*descriptorpb.FileDescriptorProto{{
		Name:    proto.String("demo.proto"),
		Package: proto.String("demo"),
		Syntax:  proto.String("proto3"),
		MessageType: []*descriptorpb.DescriptorProto{{
			Name: proto.String("Empty"),
		}},
	}}}
	raw, err := proto.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "schema.binpb"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	config := "title: Demo\ninput: schema.binpb\noutput: site\n"
	if err := os.WriteFile(filepath.Join(dir, "pbschema-lens.yaml"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Build(Request{CWD: dir})
	if err != nil {
		t.Fatal(err)
	}
	if result.Model == nil || !strings.HasSuffix(result.Model.BuildInfo.Input, "schema.binpb") {
		t.Fatalf("input %+v", result.Model.BuildInfo.Input)
	}
	if len(result.Model.Messages) != 1 || result.Model.Messages[0].FullName != "demo.Empty" {
		t.Fatalf("messages %+v", result.Model.Messages)
	}
	if _, err := os.Stat(filepath.Join(dir, "site", "index.html")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "site", "model.json")); err == nil {
		t.Fatal("site wrote a monolithic model.json")
	}
	if _, err := os.Stat(filepath.Join(dir, "site", "assets", "model", "index.json")); err != nil {
		t.Fatal(err)
	}
}

func TestInputResolvesRelativeToConfigDir(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	writeDescriptor(t, filepath.Join(sub, "schema.binpb"))
	if err := os.WriteFile(filepath.Join(root, "pbschema-lens.yaml"), []byte("title: Wrong\ninput: missing.binpb\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "pbschema-lens.yaml"), []byte("title: Right\ninput: schema.binpb\noutput: site\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Build(Request{CWD: root, ConfigFile: filepath.Join(sub, "pbschema-lens.yaml")})
	if err != nil {
		t.Fatal(err)
	}
	if result.Config.Title != "Right" {
		t.Fatalf("title %s", result.Config.Title)
	}
	if !strings.HasSuffix(filepath.ToSlash(result.Input), "sub/schema.binpb") {
		t.Fatalf("input %s", result.Input)
	}
	if _, err := os.Stat(filepath.Join(root, "site", "index.html")); err != nil {
		t.Fatal(err)
	}
}

func TestConfigBesideDescriptorWins(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	writeDescriptor(t, filepath.Join(sub, "schema.binpb"))
	if err := os.WriteFile(filepath.Join(root, "pbschema-lens.yaml"), []byte("title: Wrong\ninput: missing.binpb\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "pbschema-lens.yaml"), []byte("title: Beside\noutput: site\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Build(Request{CWD: root, Input: filepath.Join("sub", "schema.binpb")})
	if err != nil {
		t.Fatal(err)
	}
	if result.Config.Title != "Beside" {
		t.Fatalf("title %s", result.Config.Title)
	}
}

func writeDescriptor(t *testing.T, path string) {
	t.Helper()
	set := &descriptorpb.FileDescriptorSet{File: []*descriptorpb.FileDescriptorProto{{
		Name:    proto.String("demo.proto"),
		Package: proto.String("demo"),
		Syntax:  proto.String("proto3"),
		MessageType: []*descriptorpb.DescriptorProto{{
			Name: proto.String("Empty"),
		}},
	}}}
	raw, err := proto.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}
