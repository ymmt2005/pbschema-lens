package compile

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestReadAllAcceptsPipedDescriptorSet(t *testing.T) {
	set := &descriptorpb.FileDescriptorSet{
		File: []*descriptorpb.FileDescriptorProto{{
			Name:    proto.String("acme/widget/v1/widget.proto"),
			Package: proto.String("acme.widget.v1"),
			Syntax:  proto.String("proto3"),
			MessageType: []*descriptorpb.DescriptorProto{{
				Name: proto.String("Widget"),
			}},
		}},
	}
	raw, err := proto.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ReadAll(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, raw) {
		t.Fatal("piped bytes were not preserved")
	}
	var decoded descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(got, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.File[0].GetName() != "acme/widget/v1/widget.proto" {
		t.Fatalf("file %s", decoded.File[0].GetName())
	}
}

func TestReadAllRejectsEmptyInput(t *testing.T) {
	if _, err := ReadAll(bytes.NewReader(nil)); err == nil {
		t.Fatal("expected empty input to fail")
	}
}

func TestLoadReadsDescriptorFile(t *testing.T) {
	set := &descriptorpb.FileDescriptorSet{
		File: []*descriptorpb.FileDescriptorProto{{
			Name: proto.String("acme/widget/v1/widget.proto"),
		}},
	}
	raw, err := proto.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "schema.binpb")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, raw) {
		t.Fatal("file bytes were not preserved")
	}
}

func TestLoadRejectsDirectory(t *testing.T) {
	if _, err := Load(t.TempDir()); err == nil {
		t.Fatal("expected a directory to fail")
	}
}

func TestDescriptorExtensions(t *testing.T) {
	for _, path := range []string{"schema.binpb", "schema.pb", "schema.desc", "schema.fds", "schema.BINPB"} {
		if !Descriptor(path) {
			t.Fatalf("%s should be a descriptor set", path)
		}
	}
	if Descriptor("buf.yaml") || Descriptor("widget.proto") {
		t.Fatal("sources are not descriptor sets")
	}
}
