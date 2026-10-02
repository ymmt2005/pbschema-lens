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
}
