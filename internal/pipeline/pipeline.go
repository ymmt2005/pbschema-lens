package pipeline

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/config"
	"github.com/ymmt2005/pbschema-lens/internal/fds"
	"github.com/ymmt2005/pbschema-lens/internal/model"
	"github.com/ymmt2005/pbschema-lens/internal/site"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// Request is one documentation build.
type Request struct {
	CWD        string
	ConfigFile string
	Input      string
	Against    string
	Out        string
	Base       string
	Title      string
	SourceDir  string
	Commit     string
	Stdin      io.Reader
	// Prepared is set after the first successful Prepare so a later call
	// reloads that config instead of discovering a different file.
	Prepared bool
}

// Result is a built model and the directory it was written to.
type Result struct {
	Model  *model.SchemaModel
	Config config.Config
	OutDir string
	Input  string
	Bytes  []byte
}

// Prepare loads config and resolves the descriptor path.
// A relative config input is resolved from the config file's directory.
// A positional descriptor, --source, and --against stay relative to the working directory.
func Prepare(req Request) (Request, config.Config, error) {
	beside := ""
	if !req.Prepared && req.ConfigFile == "" && req.Input != "" && req.Input != "-" {
		beside = resolvePath(req.CWD, req.Input)
	}
	cfg, cfgPath, err := config.LoadNear(req.CWD, req.ConfigFile, beside)
	if err != nil {
		return req, cfg, err
	}
	req.Prepared = true
	if cfgPath != "" {
		req.ConfigFile = cfgPath
	}
	if req.Title != "" {
		cfg.Title = req.Title
	}
	if req.Base != "" {
		cfg.Base = req.Base
	}
	if req.Out != "" {
		cfg.Output = req.Out
	}
	input := req.Input
	if input == "" {
		input = resolvePath(configDir(cfgPath, req.CWD), cfg.Input)
	} else {
		input = resolvePath(req.CWD, input)
	}
	req.Input = input
	return req, cfg, nil
}

// Build reads a FileDescriptorSet and writes the static site.
func Build(req Request) (*Result, error) {
	req, cfg, err := Prepare(req)
	if err != nil {
		return nil, err
	}
	input := req.Input
	raw, err := fds.Read(input, req.Stdin)
	if err != nil {
		return nil, err
	}
	files, err := fds.Files(raw)
	if err != nil {
		return nil, err
	}
	texts := map[string]string{}
	if cfg.SourceEnabled() && req.SourceDir != "" {
		texts, err = loadSources(resolvePath(req.CWD, req.SourceDir), fileNames(files))
		if err != nil {
			return nil, err
		}
	}
	source := sourceConfig(cfg, req.Commit)
	schema, err := model.Build(files, model.BuildOptions{
		Title:          cfg.Title,
		InputLabel:     input,
		Classification: cfg.Classification(),
		Source:         source,
		SourceTexts:    texts,
		Commit:         sourceCommit(source),
	})
	if err != nil {
		return nil, err
	}
	if req.Against != "" {
		against := resolvePath(req.CWD, req.Against)
		if against == "-" && input == "-" {
			return nil, fmt.Errorf("--against cannot read stdin when the input descriptor is also stdin")
		}
		var againstStdin io.Reader
		if against == "-" {
			againstStdin = req.Stdin
		}
		previousRaw, err := fds.Read(against, againstStdin)
		if err != nil {
			return nil, err
		}
		previousFiles, err := fds.Files(previousRaw)
		if err != nil {
			return nil, err
		}
		previous, err := model.Build(previousFiles, model.BuildOptions{
			Title: cfg.Title, InputLabel: req.Against, Classification: cfg.Classification(),
		})
		if err != nil {
			return nil, err
		}
		schema.Diff = model.Diff(schema, previous, req.Against)
	}
	out := cfg.Output
	if !filepath.IsAbs(out) {
		out = filepath.Join(req.CWD, out)
	}
	if err := site.Write(out, schema, site.Options{
		Base: cfg.Base, SiteURL: cfg.SiteURL, FullText: cfg.FullText(), Title: cfg.Title,
		Descriptor: raw, WriteRefs: cfg.WriteReferences(), WriteSchema: cfg.WriteDescriptor(),
	}); err != nil {
		return nil, err
	}
	return &Result{Model: schema, Config: cfg, OutDir: out, Input: input, Bytes: raw}, nil
}

func configDir(cfgPath, cwd string) string {
	if cfgPath == "" {
		return cwd
	}
	return filepath.Dir(cfgPath)
}

// sourceConfig resolves the repository commit. The flag wins, then source.commit.
// An empty result stays empty here; link rendering substitutes the literal HEAD.
// pbschema-lens does not run git.
func sourceConfig(cfg config.Config, commitFlag string) *model.SourceConfig {
	if cfg.Source == nil && commitFlag == "" {
		return nil
	}
	commit := commitFlag
	if commit == "" && cfg.Source != nil {
		commit = cfg.Source.Commit
	}
	if cfg.Source == nil {
		return &model.SourceConfig{Commit: commit}
	}
	return &model.SourceConfig{Repository: cfg.Source.Repository, Commit: commit, URLTemplate: cfg.Source.URLTemplate}
}

func sourceCommit(cfg *model.SourceConfig) string {
	if cfg == nil {
		return ""
	}
	return cfg.Commit
}

func fileNames(files interface {
	RangeFiles(func(protoreflect.FileDescriptor) bool)
}) []string {
	var names []string
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		names = append(names, fd.Path())
		return true
	})
	return names
}

func loadSources(root string, names []string) (map[string]string, error) {
	texts := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".proto") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		for _, name := range names {
			if !sourceMatches(rel, name) {
				continue
			}
			if prev, ok := texts[name]; ok && prev != "" {
				return fmt.Errorf("proto %s matches more than one file under %s", name, root)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			texts[name] = string(raw)
		}
		return nil
	})
	return texts, err
}

// sourceMatches reports whether a file walked under --source is the descriptor path.
// The match is exact, or either path is a slash-bounded suffix of the other.
func sourceMatches(rel, name string) bool {
	return rel == name || strings.HasSuffix(name, "/"+rel) || strings.HasSuffix(rel, "/"+name)
}

func resolvePath(cwd, path string) string {
	if path == "" || path == "-" || filepath.IsAbs(path) {
		return path
	}
	if cwd == "" {
		return path
	}
	return filepath.Join(cwd, path)
}
