package site

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymmt2005/pbschema-lens/internal/model"
)

func TestRoutesHaveNoSearchPage(t *testing.T) {
	for _, route := range routes(&model.SchemaModel{}) {
		if route == "/search/" {
			t.Fatal("search opens from the header on any page and has no page of its own")
		}
	}
}

func TestStampEscapesHTML(t *testing.T) {
	raw := stamp([]byte(`<title>__TITLE__</title><html data-base="__DATA_BASE__" data-site-url="__SITE_URL__">`), "/", Options{
		Title:   `</title><script>alert(1)</script>`,
		SiteURL: `https://ex.test/?a=1&b=2`,
	})
	text := string(raw)
	if strings.Contains(text, "<script>") || strings.Contains(text, "</title><script>") {
		t.Fatalf("title broke out of the shell: %s", text)
	}
	if !strings.Contains(text, "&lt;/title&gt;&lt;script&gt;") {
		t.Fatalf("title was not escaped: %s", text)
	}
	if !strings.Contains(text, "a=1&amp;b=2") {
		t.Fatalf("site url was not escaped: %s", text)
	}
}

func TestValidateBaseRejectsMarkup(t *testing.T) {
	if err := validateBase(`/"><script>`); err == nil {
		t.Fatal("expected base rejection")
	}
	if err := validateBase("/docs/"); err != nil {
		t.Fatal(err)
	}
	if err := validateBase("//host/"); err == nil {
		t.Fatal("accepted a protocol-relative base")
	}
}

func TestHandlerServesBasePrefix(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets", "model"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "model", "index.json"), []byte(`{"title":"demo"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("home"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(Handler(dir, "/pbschema-lens/"))
	t.Cleanup(server.Close)
	for _, path := range []string{"/pbschema-lens/", "/pbschema-lens/assets/model/index.json"} {
		res, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: %s", path, res.Status)
		}
	}
	root, err := http.Get(server.URL + "/assets/model/index.json")
	if err != nil {
		t.Fatal(err)
	}
	root.Body.Close()
	if root.StatusCode == http.StatusOK {
		t.Fatal("index.json was served at / instead of the base prefix")
	}
}
