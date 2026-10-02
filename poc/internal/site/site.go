// Package site writes the embedded page and model.json into an output directory.
package site

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/ymmt2005/pbschema-lens/poc/internal/model"
)

//go:embed index.html
//go:embed assets/app.js
var assets embed.FS

// Write copies the page shell to the home route and to each message route,
// and writes model.json beside those files.
func Write(outDir string, doc *model.Model, base string) error {
	base, err := NormalizeBase(base)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	shell, err := shellHTML(doc.Title, base)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outDir, "index.html"), shell, 0o644); err != nil {
		return err
	}
	for _, message := range doc.Messages {
		if err := writeShell(outDir, messageRel(message.URLPath), shell); err != nil {
			return err
		}
	}
	script, err := fs.ReadFile(assets, "assets/app.js")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(outDir, "assets"), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outDir, "assets", "app.js"), script, 0o644); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, "model.json"), append(raw, '\n'), 0o644)
}

// NormalizeBase returns a site path that starts and ends with a slash.
func NormalizeBase(base string) (string, error) {
	if base == "" {
		base = "/"
	}
	if !strings.HasPrefix(base, "/") || strings.Contains(base, "..") || strings.ContainsAny(base, "\\?#") {
		return "", fmt.Errorf("base must be a site path starting with /")
	}
	if !strings.HasSuffix(base, "/") {
		base += "/"
	}
	return base, nil
}

func shellHTML(title, base string) ([]byte, error) {
	raw, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		return nil, err
	}
	raw = bytes.ReplaceAll(raw, []byte("__BASE__"), []byte(html.EscapeString(base)))
	raw = bytes.ReplaceAll(raw, []byte("__TITLE__"), []byte(html.EscapeString(title)))
	if bytes.Contains(raw, []byte("__BASE__")) || bytes.Contains(raw, []byte("__TITLE__")) {
		return nil, fmt.Errorf("page shell still contains a placeholder")
	}
	return raw, nil
}

func messageRel(urlPath string) string {
	return strings.TrimPrefix(path.Clean("/"+urlPath), "/")
}

func writeShell(outDir, rel string, shell []byte) error {
	if rel == "" || rel == "." || rel == ".." || strings.HasPrefix(rel, "../") || strings.Contains(rel, "/../") {
		return fmt.Errorf("refusing to write unsafe path %q", rel)
	}
	dir := filepath.Join(outDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "index.html"), shell, 0o644)
}

// SafePath resolves a request path inside root. Directory URLs map to index.html.
func SafePath(root, requestPath string) (string, error) {
	rel := strings.TrimPrefix(path.Clean("/"+requestPath), "/")
	if rel == "" || rel == "." {
		rel = "index.html"
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	full := filepath.Join(absRoot, filepath.FromSlash(rel))
	if info, statErr := os.Stat(full); statErr == nil && info.IsDir() {
		full = filepath.Join(full, "index.html")
	}
	relative, err := filepath.Rel(absRoot, full)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes the output directory")
	}
	return full, nil
}
