package compile

import "testing"

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
