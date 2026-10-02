// Package compile loads a FileDescriptorSet from a descriptor file or by
// running the buf CLI. The proof-of-concept binary does not embed buf.
package compile

import (
	"fmt"
	"os"
	"os/exec"
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

// Load returns FileDescriptorSet bytes for a descriptor file or a Buf module
// directory. A directory is compiled with the buf binary on PATH.
func Load(input string) ([]byte, error) {
	info, err := os.Stat(input)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return loadBuf(input)
	}
	if !Descriptor(input) {
		return nil, fmt.Errorf("%s is not a Buf module directory or a FileDescriptorSet (.binpb, .pb, .desc, .fds)", input)
	}
	return os.ReadFile(input)
}

func loadBuf(dir string) ([]byte, error) {
	if _, err := os.Stat(filepath.Join(dir, "buf.yaml")); err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%s has no buf.yaml; pass a Buf module or a FileDescriptorSet", dir)
		}
		return nil, err
	}
	bin, err := exec.LookPath("buf")
	if err != nil {
		return nil, fmt.Errorf("buf CLI was not found on PATH")
	}
	tmp, err := os.CreateTemp("", "pbschema-poc-*.binpb")
	if err != nil {
		return nil, err
	}
	name := tmp.Name()
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	defer os.Remove(name)
	cmd := exec.Command(bin, "build", "--as-file-descriptor-set", "-o", name)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("buf build failed: %w\n%s", err, out)
	}
	return os.ReadFile(name)
}
