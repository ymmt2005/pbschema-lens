package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadsConfigFromParentPath(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "secret.yaml"), []byte("title: Outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, _, err := Load(sub, filepath.Join("..", "secret.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Title != "Outside" {
		t.Fatalf("title %s", cfg.Title)
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

func TestLoadNearPrefersConfigBesideInput(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pbschema-lens.yaml"), []byte("title: Wrong\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "pbschema-lens.yaml"), []byte("title: Beside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, path, err := LoadNear(root, "", filepath.Join(sub, "schema.binpb"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Title != "Beside" || filepath.Dir(path) != sub {
		t.Fatalf("cfg %+v path %s", cfg.Title, path)
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
