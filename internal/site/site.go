package site

import (
	"encoding/json"
	"fmt"
	"html"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/model"
)

// Options controls one static site write.
type Options struct {
	Base        string
	SiteURL     string
	FullText    bool
	Title       string
	Descriptor  []byte
	WriteRefs   bool
	WriteSchema bool
}

// Write copies the embedded UI, stamps the base path, and writes one shell per route.
// Every generated file is written through an os.Root opened on the output directory.
func Write(outDir string, schema *model.SchemaModel, opts Options) error {
	base := normalizeBase(opts.Base)
	if err := validateBase(base); err != nil {
		return err
	}
	out, err := openOutput(outDir)
	if err != nil {
		return err
	}
	defer out.Close()
	if err := fs.WalkDir(Dist, "dist", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(name, "dist")
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			return nil
		}
		target := filepath.FromSlash(rel)
		if entry.IsDir() {
			return out.MkdirAll(target, 0o755)
		}
		raw, err := Dist.ReadFile(name)
		if err != nil {
			return err
		}
		if isText(name) {
			raw = stamp(raw, base, opts)
		}
		return writeFile(out, target, raw)
	}); err != nil {
		return err
	}
	if err := writeModel(out, schema, opts.FullText); err != nil {
		return err
	}
	shell, err := out.ReadFile("index.html")
	if err != nil {
		return err
	}
	for _, route := range routes(schema) {
		if route == "/" {
			continue
		}
		dir := filepath.FromSlash(strings.Trim(route, "/"))
		if err := writeFile(out, filepath.Join(dir, "index.html"), shell); err != nil {
			return err
		}
	}
	return writeArtifacts(out, schema, opts)
}

func writeArtifacts(out *os.Root, schema *model.SchemaModel, opts Options) error {
	dir := filepath.Join("assets", "protobuf")
	index, err := json.MarshalIndent(schema.SymbolIndex, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFile(out, filepath.Join(dir, "symbols.json"), index); err != nil {
		return err
	}
	info, err := json.MarshalIndent(schema.BuildInfo, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFile(out, filepath.Join(dir, "build-info.json"), info); err != nil {
		return err
	}
	if opts.WriteRefs {
		raw, err := json.Marshal(collectReferences(schema))
		if err != nil {
			return err
		}
		if err := writeFile(out, filepath.Join(dir, "references.json"), raw); err != nil {
			return err
		}
	}
	if opts.WriteSchema && len(opts.Descriptor) > 0 {
		if err := writeFile(out, filepath.Join(dir, "schema.binpb"), opts.Descriptor); err != nil {
			return err
		}
	}
	return nil
}

func writeFile(out *os.Root, name string, data []byte) error {
	if dir := filepath.Dir(name); dir != "." {
		if err := out.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return out.WriteFile(name, data, 0o644)
}

func collectReferences(schema *model.SchemaModel) []model.SymbolReference {
	var refs []model.SymbolReference
	for _, symbol := range schema.Symbols {
		refs = append(refs, referencesOf(symbol)...)
	}
	if refs == nil {
		refs = []model.SymbolReference{}
	}
	return refs
}

func referencesOf(symbol any) []model.SymbolReference {
	switch s := symbol.(type) {
	case *model.DocPackage:
		return s.References
	case *model.DocFile:
		return s.References
	case *model.DocMessage:
		return s.References
	case *model.DocField:
		return s.References
	case *model.DocOneof:
		return s.References
	case *model.DocEnum:
		return s.References
	case *model.DocEnumValue:
		return s.References
	case *model.DocService:
		return s.References
	case *model.DocMethod:
		return s.References
	case *model.DocExtension:
		return s.References
	default:
		return nil
	}
}

func routes(schema *model.SchemaModel) []string {
	seen := map[string]struct{}{"/": {}, "/search/": {}, "/explore/": {}, "/graph/": {}}
	add := func(route string) {
		if route == "" {
			return
		}
		if !strings.HasSuffix(route, "/") {
			route += "/"
		}
		seen[route] = struct{}{}
	}
	collect := func(page bool, urlPath string) {
		if page {
			add(urlPath)
		}
	}
	for _, item := range schema.Packages {
		collect(item.GeneratePage, item.URLPath)
	}
	for _, item := range schema.Messages {
		collect(item.GeneratePage, item.URLPath)
	}
	for _, item := range schema.Enums {
		collect(item.GeneratePage, item.URLPath)
	}
	for _, item := range schema.Services {
		collect(item.GeneratePage, item.URLPath)
	}
	for _, item := range schema.Methods {
		collect(item.GeneratePage, item.URLPath)
	}
	for _, item := range schema.Extensions {
		collect(item.GeneratePage, item.URLPath)
	}
	for _, item := range schema.Files {
		collect(item.GeneratePage, item.URLPath)
	}
	source := false
	for _, item := range schema.Files {
		if item.SourceText != "" && item.GeneratePage {
			source = true
		}
	}
	if source {
		add("/source/")
	}
	if schema.Diff != nil {
		add("/diff/")
	}
	out := make([]string, 0, len(seen))
	for route := range seen {
		out = append(out, route)
	}
	return out
}

func stamp(raw []byte, base string, opts Options) []byte {
	text := string(raw)
	assetBase := strings.Trim(base, "/")
	if assetBase != "" {
		assetBase += "/"
	}
	text = strings.ReplaceAll(text, "/__PBSCHEMA_BASE__/", "/"+assetBase)
	text = strings.ReplaceAll(text, "__DATA_BASE__", html.EscapeString(base))
	text = strings.ReplaceAll(text, "__SITE_URL__", html.EscapeString(opts.SiteURL))
	full := "false"
	if opts.FullText {
		full = "true"
	}
	text = strings.ReplaceAll(text, "__FULL_TEXT__", full)
	title := opts.Title
	if title == "" {
		title = "Protobuf API"
	}
	text = strings.ReplaceAll(text, "__TITLE__", html.EscapeString(title))
	return []byte(text)
}

// Handler serves a built site. base is the path prefix stamped into the pages.
func Handler(dir, base string) http.Handler {
	base = normalizeBase(base)
	files := http.FileServer(http.Dir(dir))
	if base == "/" {
		return files
	}
	prefix := strings.TrimSuffix(base, "/")
	mux := http.NewServeMux()
	mux.Handle(prefix+"/", http.StripPrefix(prefix, files))
	mux.HandleFunc(prefix, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, prefix+"/", http.StatusTemporaryRedirect)
	})
	return mux
}

func validateBase(base string) error {
	if strings.Contains(base, "..") {
		return fmt.Errorf("base %q must not contain ..", base)
	}
	if strings.Contains(base, "//") {
		return fmt.Errorf("base %q must be a same-origin path", base)
	}
	for _, r := range base {
		switch {
		case r == '/' || r == '-' || r == '_' || r == '.' || r == '~':
		case r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9':
		default:
			return fmt.Errorf("base %q must be a URL path", base)
		}
	}
	return nil
}

func normalizeBase(base string) string {
	if base == "" || base == "/" {
		return "/"
	}
	if !strings.HasPrefix(base, "/") {
		base = "/" + base
	}
	if !strings.HasSuffix(base, "/") {
		base += "/"
	}
	return base
}

func isText(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".js", ".css", ".svg", ".json", ".txt", ".map":
		return true
	default:
		return false
	}
}

// openOutput creates outDir as a child of its parent and returns a root confined to it.
// The parent, the working directory, and any ancestor of the working directory are refused
// so RemoveAll cannot erase the checkout or a filesystem root.
func openOutput(outDir string) (*os.Root, error) {
	if strings.TrimSpace(outDir) == "" {
		return nil, fmt.Errorf("refusing to write site output to %q", outDir)
	}
	abs, err := filepath.Abs(outDir)
	if err != nil {
		return nil, err
	}
	abs = filepath.Clean(abs)
	parent := filepath.Dir(abs)
	name := filepath.Base(abs)
	if parent == abs || name == "." || name == ".." {
		return nil, fmt.Errorf("invalid output directory %q", outDir)
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	cwdAbs, err := filepath.Abs(cwd)
	if err != nil {
		return nil, err
	}
	cwdAbs = filepath.Clean(cwdAbs)
	if abs == cwdAbs || dirContains(abs, cwdAbs) {
		return nil, fmt.Errorf("refusing to write site output to %q", outDir)
	}
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return nil, err
	}
	parentRoot, err := os.OpenRoot(parent)
	if err != nil {
		return nil, err
	}
	defer parentRoot.Close()
	if err := parentRoot.RemoveAll(name); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err := parentRoot.Mkdir(name, 0o755); err != nil {
		return nil, err
	}
	return parentRoot.OpenRoot(name)
}

// dirContains reports whether child is strictly inside dir.
func dirContains(dir, child string) bool {
	rel, err := filepath.Rel(dir, child)
	if err != nil {
		return false
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
