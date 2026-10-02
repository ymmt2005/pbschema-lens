package site

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymmt2005/pbschema-lens/poc/internal/model"
)

func TestWriteEmitsShellModelAndScript(t *testing.T) {
	doc := &model.Model{
		Title: "Widgets <script>",
		Messages: []model.Message{{
			FullName: "acme.widget.v1.Widget",
			URLPath:  "/reference/messages/acme.widget.v1.Widget/",
			Fields:   []model.Field{{Name: "id", Number: 1, Type: "string"}},
		}},
	}
	out := t.TempDir()
	if err := Write(out, doc, "/pbschema-lens"); err != nil {
		t.Fatal(err)
	}

	home, err := os.ReadFile(filepath.Join(out, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(home, []byte(`href="/pbschema-lens/"`)) {
		t.Fatalf("base was not substituted: %s", home)
	}
	if bytes.Contains(home, []byte("__BASE__")) || bytes.Contains(home, []byte("__TITLE__")) {
		t.Fatal("placeholder left in the shell")
	}
	if !bytes.Contains(home, []byte("Widgets &lt;script&gt;")) {
		t.Fatal("title was not escaped")
	}
	page, err := os.ReadFile(filepath.Join(out, "reference", "messages", "acme.widget.v1.Widget", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(home, page) {
		t.Fatal("message route should reuse the home shell")
	}
	raw, err := os.ReadFile(filepath.Join(out, "model.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"fullName": "acme.widget.v1.Widget"`)) {
		t.Fatalf("model.json missing message: %s", raw)
	}
	script, err := os.ReadFile(filepath.Join(out, "assets", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(script, []byte("model.json")) {
		t.Fatal("compiled page does not fetch model.json")
	}
}

func TestNormalizeBase(t *testing.T) {
	got, err := NormalizeBase("/pbschema-lens")
	if err != nil || got != "/pbschema-lens/" {
		t.Fatalf("got %q %v", got, err)
	}
	if _, err := NormalizeBase("/"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"../out", "https://evil.example/", "/foo?x", `..\x`} {
		if _, err := NormalizeBase(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestSafePathStaysInsideRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	home, err := SafePath(root, "/")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(home) != "index.html" {
		t.Fatalf("home %s", home)
	}
	escaped, err := SafePath(root, "/../../etc/passwd")
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(root, escaped)
	if err != nil {
		t.Fatal(err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		t.Fatalf("path escaped the output directory: %s", escaped)
	}
}

func TestWriteRejectsDotDotRoute(t *testing.T) {
	doc := &model.Model{
		Title: "Bad",
		Messages: []model.Message{{
			FullName: "..",
			URLPath:  "/../",
		}},
	}
	err := Write(t.TempDir(), doc, "/")
	if err == nil {
		t.Fatal("expected an unsafe message path to be rejected")
	}
}
