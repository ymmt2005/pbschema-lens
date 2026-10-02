package fds

import (
	"fmt"
	"io"
	"os"
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Read loads a FileDescriptorSet from a file path or from stdin when path is "-".
func Read(path string, stdin io.Reader) ([]byte, error) {
	if strings.Contains(path, "..") {
		return nil, fmt.Errorf("path %q must not contain ..", path)
	}
	var raw []byte
	var err error
	if path == "" || path == "-" {
		raw, err = io.ReadAll(stdin)
	} else {
		raw, err = os.ReadFile(path)
	}
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("FileDescriptorSet is empty")
	}
	return raw, nil
}

// Files parses descriptor bytes into a linked file registry.
func Files(raw []byte) (*protoregistry.Files, error) {
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(raw, &set); err != nil {
		return nil, fmt.Errorf("parse FileDescriptorSet: %w", err)
	}
	if len(set.File) == 0 {
		return nil, fmt.Errorf("FileDescriptorSet contains no files")
	}
	files, err := protodesc.NewFiles(&set)
	if err != nil {
		return nil, fmt.Errorf("link FileDescriptorSet: %w", err)
	}
	return files, nil
}
