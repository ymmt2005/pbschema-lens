package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/classify"
	"gopkg.in/yaml.v3"
)

// Config is pbschema-lens.yaml.
type Config struct {
	Title          string         `yaml:"title"`
	Input          string         `yaml:"input"`
	Output         string         `yaml:"output"`
	Base           string         `yaml:"base"`
	SiteURL        string         `yaml:"siteUrl"`
	Source         *Source        `yaml:"source"`
	Documentation  *Documentation `yaml:"documentation"`
	WellKnownTypes *WellKnown     `yaml:"wellKnownTypes"`
	Search         *Search        `yaml:"search"`
	SourceBrowser  *SourceBrowser `yaml:"sourceBrowser"`
	Artifacts      *Artifacts     `yaml:"artifacts"`
	ExternalLinks  []ExternalLink `yaml:"externalLinks"`
	Plugins        []string       `yaml:"plugins"`
}

type Source struct {
	Repository  string `yaml:"repository"`
	Commit      string `yaml:"commit"`
	URLTemplate string `yaml:"urlTemplate"`
}

type Documentation struct {
	Include []string `yaml:"include"`
	Exclude []string `yaml:"exclude"`
}

type WellKnown struct {
	Enabled *bool `yaml:"enabled"`
}

type Search struct {
	FullText *bool `yaml:"fullText"`
}

type SourceBrowser struct {
	Enabled *bool `yaml:"enabled"`
}

type Artifacts struct {
	DescriptorSet *bool `yaml:"descriptorSet"`
	References    *bool `yaml:"references"`
}

type ExternalLink struct {
	Package     string `yaml:"package"`
	URLTemplate string `yaml:"urlTemplate"`
}

// LoadNear reads config from an explicit path, from beside a descriptor file, or from cwd.
// beside is the descriptor path. A config next to that file wins over one in cwd.
func LoadNear(cwd, explicit, beside string) (Config, string, error) {
	if explicit != "" {
		return Load(cwd, explicit)
	}
	if beside != "" && beside != "-" {
		dir := filepath.Dir(beside)
		for _, name := range []string{"pbschema-lens.yaml", "pbschema-lens.yml"} {
			candidate := filepath.Join(dir, name)
			info, err := os.Stat(candidate)
			if err == nil && !info.IsDir() {
				return Load(dir, candidate)
			}
		}
	}
	return Load(cwd, "")
}

// Load reads config from an explicit path or from the working directory.
func Load(cwd, explicit string) (Config, string, error) {
	path := explicit
	if path == "" {
		for _, name := range []string{"pbschema-lens.yaml", "pbschema-lens.yml"} {
			candidate := filepath.Join(cwd, name)
			if _, err := os.Stat(candidate); err == nil {
				path = candidate
				break
			}
		}
	} else if !filepath.IsAbs(path) {
		path = filepath.Join(cwd, path)
	}
	cfg := defaults()
	if path == "" {
		return cfg, "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, "", err
	}
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return Config{}, "", fmt.Errorf("parse %s: %w", path, err)
	}
	cfg.applyDefaults()
	if len(cfg.Plugins) > 0 {
		return Config{}, path, fmt.Errorf("plugins are not supported: the pbschema-lens binary does not load Node modules (%s)", strings.Join(cfg.Plugins, ", "))
	}
	return cfg, path, nil
}

func defaults() Config {
	return Config{Title: "Protobuf API", Input: "-", Output: "dist", Base: "/"}
}

func (c *Config) applyDefaults() {
	if c.Title == "" {
		c.Title = "Protobuf API"
	}
	if c.Input == "" {
		c.Input = "-"
	}
	if c.Output == "" {
		c.Output = "dist"
	}
	if c.Base == "" {
		c.Base = "/"
	}
}

// FullText reports whether comment search is enabled. Omitted means yes.
func (c Config) FullText() bool {
	return c.Search == nil || c.Search.FullText == nil || *c.Search.FullText
}

// SourceEnabled reports whether proto text should be attached.
func (c Config) SourceEnabled() bool {
	return c.SourceBrowser == nil || c.SourceBrowser.Enabled == nil || *c.SourceBrowser.Enabled
}

// WriteReferences reports whether references.json is written.
func (c Config) WriteReferences() bool {
	return c.Artifacts == nil || c.Artifacts.References == nil || *c.Artifacts.References
}

// WriteDescriptor reports whether schema.binpb is copied next to the site.
func (c Config) WriteDescriptor() bool {
	return c.Artifacts != nil && c.Artifacts.DescriptorSet != nil && *c.Artifacts.DescriptorSet
}

// WellKnownEnabled reports whether well-known type pages are published.
func (c Config) WellKnownEnabled() bool {
	return c.WellKnownTypes == nil || c.WellKnownTypes.Enabled == nil || *c.WellKnownTypes.Enabled
}

// Classification converts documentation rules into the model classifier config.
func (c Config) Classification() classify.Config {
	out := classify.Config{WellKnownTypes: c.WellKnownEnabled()}
	if c.Documentation != nil {
		out.Include = c.Documentation.Include
		out.Exclude = c.Documentation.Exclude
	}
	for _, link := range c.ExternalLinks {
		out.ExternalLinks = append(out.ExternalLinks, classify.ExternalLink{
			Package: link.Package, URLTemplate: link.URLTemplate,
		})
	}
	return out
}
