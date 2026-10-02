// Package compile reads a FileDescriptorSet. The caller produces that set,
// for example by piping `buf build -o - --as-file-descriptor-set`.
package compile

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Descriptor reports whether path is a FileDescriptorSet file.
func Descriptor(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".binpb", ".pb", ".desc", ".fds":
		return true
	default:
		return false
	}
}

// ReadAll reads a FileDescriptorSet from r.
func ReadAll(r io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("FileDescriptorSet is empty")
	}
	return raw, nil
}

// Load reads a FileDescriptorSet from a descriptor file.
func Load(input string) ([]byte, error) {
	info, err := os.Stat(input)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%s is a directory; pipe buf output instead: buf build -o - --as-file-descriptor-set | pbschema-poc build", input)
	}
	if !Descriptor(input) {
		return nil, fmt.Errorf("%s is not a FileDescriptorSet (.binpb, .pb, .desc, .fds)", input)
	}
	file, err := os.Open(input)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return ReadAll(file)
}
