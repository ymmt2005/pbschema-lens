package compile

import (
	"os"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestLoadCompilesModuleWithoutBufBinary(t *testing.T) {
	t.Setenv("PATH", "/usr/bin:/bin")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "buf.yaml"), []byte("version: v2\nmodules:\n  - path: proto\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	protoDir := filepath.Join(dir, "proto", "acme", "widget", "v1")
	if err := os.MkdirAll(protoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	const source = `syntax = "proto3";
package acme.widget.v1;
import "google/protobuf/timestamp.proto";
message Widget {
  string id = 1;
  google.protobuf.Timestamp created = 2;
}
`
	if err := os.WriteFile(filepath.Join(protoDir, "widget.proto"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	raw, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(raw, &set); err != nil {
		t.Fatal(err)
	}
	var widget, timestamp bool
	for _, file := range set.File {
		switch file.GetName() {
		case "acme/widget/v1/widget.proto":
			widget = true
			if len(file.MessageType) != 1 || file.MessageType[0].GetName() != "Widget" {
				t.Fatalf("widget descriptor %#v", file.MessageType)
			}
		case "google/protobuf/timestamp.proto":
			timestamp = true
		}
	}
	if !widget || !timestamp {
		t.Fatalf("missing compiled files widget=%v timestamp=%v", widget, timestamp)
	}
}

func TestLoadRejectsDirectoryWithoutBufYAML(t *testing.T) {
	if _, err := Load(t.TempDir()); err == nil {
		t.Fatal("expected a directory without buf.yaml to fail")
	}
}

func TestLoadRejectsBufYAMLV1(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "buf.yaml"), []byte("version: v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil {
		t.Fatal("expected buf.yaml v1 to fail")
	}
}

func TestParseModuleName(t *testing.T) {
	owner, module, err := parseModuleName("buf.build/bufbuild/protovalidate")
	if err != nil || owner != "bufbuild" || module != "protovalidate" {
		t.Fatalf("got %s %s %v", owner, module, err)
	}
	if _, _, err := parseModuleName("not-a-module"); err == nil {
		t.Fatal("expected an unsupported module name to fail")
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
