// Package compile loads a FileDescriptorSet from a descriptor file or by
// compiling a Buf module in-process. Compilation uses protocompile, the
// compiler linked into Buf, and does not execute a buf binary.
package compile

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/wellknownimports"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
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
// directory.
func Load(input string) ([]byte, error) {
	info, err := os.Stat(input)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return loadModule(context.Background(), input)
	}
	if !Descriptor(input) {
		return nil, fmt.Errorf("%s is not a Buf module directory or a FileDescriptorSet (.binpb, .pb, .desc, .fds)", input)
	}
	return os.ReadFile(input)
}

func loadModule(ctx context.Context, dir string) ([]byte, error) {
	sources, roots, err := moduleSources(ctx, dir)
	if err != nil {
		return nil, err
	}
	if len(roots) == 0 {
		return nil, fmt.Errorf("%s has no .proto files", dir)
	}
	compiler := protocompile.Compiler{
		Resolver: wellknownimports.WithStandardImports(&protocompile.SourceResolver{
			Accessor: protocompile.SourceAccessorFromMap(sources),
		}),
		SourceInfoMode: protocompile.SourceInfoStandard,
	}
	linked, err := compiler.Compile(ctx, roots...)
	if err != nil {
		return nil, fmt.Errorf("compile %s: %w", dir, err)
	}
	set := &descriptorpb.FileDescriptorSet{}
	seen := map[string]struct{}{}
	for _, file := range linked {
		collectFile(file, seen, set)
	}
	return proto.Marshal(set)
}

func collectFile(file protoreflect.FileDescriptor, seen map[string]struct{}, set *descriptorpb.FileDescriptorSet) {
	if file == nil {
		return
	}
	if _, ok := seen[file.Path()]; ok {
		return
	}
	seen[file.Path()] = struct{}{}
	imports := file.Imports()
	for i := 0; i < imports.Len(); i++ {
		collectFile(imports.Get(i), seen, set)
	}
	set.File = append(set.File, protodesc.ToFileDescriptorProto(file))
}

// readSource reads a proto file as text. It rejects paths that escape root.
func readSource(root, rel string) (string, error) {
	rel = filepath.Clean(rel)
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("refusing to read %s", rel)
	}
	raw, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
