package compile

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"buf.build/gen/go/bufbuild/registry/connectrpc/go/buf/registry/module/v1/modulev1connect"
	modulev1 "buf.build/gen/go/bufbuild/registry/protocolbuffers/go/buf/registry/module/v1"
	"connectrpc.com/connect"
	"gopkg.in/yaml.v3"
)

const bsrBaseURL = "https://buf.build"

type moduleConfig struct {
	Version string `yaml:"version"`
	Modules []struct {
		Path string `yaml:"path"`
	} `yaml:"modules"`
	Deps []string `yaml:"deps"`
}

type lockFile struct {
	Deps []struct {
		Name   string `yaml:"name"`
		Commit string `yaml:"commit"`
	} `yaml:"deps"`
}

// moduleSources returns proto sources keyed by import path, and the import
// paths that belong to the module itself.
func moduleSources(ctx context.Context, dir string) (map[string]string, []string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "buf.yaml"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("%s has no buf.yaml; pass a Buf module or a FileDescriptorSet", dir)
		}
		return nil, nil, err
	}
	var cfg moduleConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, nil, fmt.Errorf("parse buf.yaml: %w", err)
	}
	if cfg.Version != "v2" {
		return nil, nil, fmt.Errorf("only buf.yaml v2 is supported, found %q", cfg.Version)
	}
	if len(cfg.Modules) == 0 {
		return nil, nil, fmt.Errorf("%s buf.yaml has no modules", dir)
	}
	sources := map[string]string{}
	var roots []string
	for _, module := range cfg.Modules {
		moduleRoot := dir
		if module.Path != "" && module.Path != "." {
			moduleRoot = filepath.Join(dir, module.Path)
		}
		files, err := protoFiles(moduleRoot)
		if err != nil {
			return nil, nil, err
		}
		for _, rel := range files {
			text, err := readSource(moduleRoot, rel)
			if err != nil {
				return nil, nil, err
			}
			if _, exists := sources[rel]; exists {
				return nil, nil, fmt.Errorf("duplicate proto path %s", rel)
			}
			sources[rel] = text
			roots = append(roots, rel)
		}
	}
	sort.Strings(roots)
	if len(cfg.Deps) > 0 {
		deps, err := downloadDeps(ctx, dir, cfg.Deps)
		if err != nil {
			return nil, nil, err
		}
		for path, text := range deps {
			if _, exists := sources[path]; exists {
				continue
			}
			sources[path] = text
		}
	}
	return sources, roots, nil
}

func protoFiles(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "node_modules", "dist":
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".proto") {
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	return files, err
}

func downloadDeps(ctx context.Context, dir string, names []string) (map[string]string, error) {
	commits, err := lockCommits(dir)
	if err != nil {
		return nil, err
	}
	values := make([]*modulev1.DownloadRequest_Value, 0, len(names))
	for _, name := range names {
		owner, module, err := parseModuleName(name)
		if err != nil {
			return nil, err
		}
		ref := &modulev1.ResourceRef{}
		named := &modulev1.ResourceRef_Name{Owner: owner, Module: module}
		if commit := commits[name]; commit != "" {
			named.SetRef(commit)
		}
		ref.SetName(named)
		value := &modulev1.DownloadRequest_Value{}
		value.SetResourceRef(ref)
		value.SetFileTypes([]modulev1.FileType{modulev1.FileType_FILE_TYPE_PROTO})
		values = append(values, value)
	}
	client := modulev1connect.NewDownloadServiceClient(&http.Client{Timeout: 60 * time.Second}, bsrBaseURL)
	response, err := client.Download(ctx, connect.NewRequest(&modulev1.DownloadRequest{Values: values}))
	if err != nil {
		return nil, fmt.Errorf("download module dependencies: %w", err)
	}
	sources := map[string]string{}
	for _, content := range response.Msg.GetContents() {
		for _, file := range content.GetFiles() {
			path := file.GetPath()
			if !strings.HasSuffix(path, ".proto") {
				continue
			}
			sources[path] = string(file.GetContent())
		}
	}
	return sources, nil
}

func lockCommits(dir string) (map[string]string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "buf.lock"))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	var lock lockFile
	if err := yaml.Unmarshal(raw, &lock); err != nil {
		return nil, fmt.Errorf("parse buf.lock: %w", err)
	}
	commits := make(map[string]string, len(lock.Deps))
	for _, dep := range lock.Deps {
		commits[dep.Name] = dep.Commit
	}
	return commits, nil
}

func parseModuleName(name string) (owner, module string, err error) {
	trimmed := strings.TrimPrefix(name, "buf.build/")
	owner, module, ok := strings.Cut(trimmed, "/")
	if !ok || owner == "" || module == "" || strings.Contains(module, "/") {
		return "", "", fmt.Errorf("unsupported module name %q", name)
	}
	return owner, module, nil
}
