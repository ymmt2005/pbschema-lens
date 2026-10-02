package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRejectsParentSegments(t *testing.T) {
	_, _, err := Load(".", "../secret.yaml")
	if err == nil {
		t.Fatal("expected path rejection")
	}
}

func TestPluginsAreRejected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "pbschema-lens.yaml")
	if err := os.WriteFile(path, []byte("plugins:\n  - \"./plugin.mjs\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, _, err := Load(dir, "")
	if err == nil {
		t.Fatal("expected plugins to be rejected")
	}
}

func TestOmittedFullTextStaysOn(t *testing.T) {
	cfg, _, err := Load(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.FullText() || !cfg.WriteReferences() || !cfg.WellKnownEnabled() {
		t.Fatalf("defaults %+v", cfg)
	}
}
