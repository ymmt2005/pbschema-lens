package fds

import (
	"fmt"
	"io"
	"os"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Read loads a FileDescriptorSet from a file path or from stdin when path is "-".
func Read(path string, stdin io.Reader) ([]byte, error) {
	var raw []byte
	var err error
	if path == "" || path == "-" {
		if stdin == nil {
			return nil, fmt.Errorf("no stdin to read a FileDescriptorSet from")
		}
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

// FileSet is a linked descriptor set. RangeFiles visits files in descriptor order.
type FileSet struct {
	list []protoreflect.FileDescriptor
}

// RangeFiles visits files in the order they appear in the FileDescriptorSet.
func (s *FileSet) RangeFiles(fn func(protoreflect.FileDescriptor) bool) {
	for _, fd := range s.list {
		if !fn(fd) {
			return
		}
	}
}

// Files parses descriptor bytes into a linked file registry.
func Files(raw []byte) (*FileSet, error) {
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(raw, &set); err != nil {
		return nil, fmt.Errorf("parse FileDescriptorSet: %w", err)
	}
	if len(set.File) == 0 {
		return nil, fmt.Errorf("FileDescriptorSet contains no files")
	}
	reg, err := protodesc.NewFiles(&set)
	if err != nil {
		return nil, fmt.Errorf("link FileDescriptorSet: %w", err)
	}
	list := make([]protoreflect.FileDescriptor, 0, len(set.File))
	for _, file := range set.File {
		fd, err := reg.FindFileByPath(file.GetName())
		if err != nil {
			return nil, fmt.Errorf("descriptor %s: %w", file.GetName(), err)
		}
		list = append(list, fd)
	}
	return &FileSet{list: list}, nil
}
