package site

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/model"
)

//go:embed templates/*.html
var pageTemplates embed.FS

type renderer struct {
	schema    *model.SchemaModel
	opts      Options
	base      string
	index     siteIndex
	entries   map[string]indexedSymbol
	packages  map[string]*model.DocPackage
	files     map[string]*model.DocFile
	pages     map[string]any
	templates *template.Template
}

func newRenderer(schema *model.SchemaModel, opts Options) (*renderer, error) {
	r := &renderer{schema: schema, opts: opts, base: normalizeBase(opts.Base), index: buildIndex(schema), entries: map[string]indexedSymbol{}, packages: map[string]*model.DocPackage{}, files: map[string]*model.DocFile{}, pages: map[string]any{}}
	for _, e := range r.index.SymbolIndex {
		r.entries[e.ID] = e
	}
	for _, p := range schema.Packages {
		r.packages[p.FullName] = p
	}
	for _, f := range schema.Files {
		r.files[f.FullName] = f
		if f.GeneratePage && f.SourceText != "" {
			r.pages[f.URLPath] = f
		}
	}
	for _, id := range pageSymbolIDs(schema) {
		s := schema.Symbols[id]
		if b := model.SymbolMetadata(s); b != nil {
			r.pages[b.URLPath] = s
		}
	}
	funcs := template.FuncMap{
		"homeStats": r.homeStats,
		"themeChoices": func() []struct{ Value, Label string } {
			return []struct{ Value, Label string }{{"system", "Follow desktop"}, {"light", "Light"}, {"dark", "Dark"}}
		},

		"hasWKT": func() bool {
			for _, p := range schema.Packages {
				if p.Domain == "well-known" && p.GeneratePage {
					return true
				}
			}
			return false
		},
		"href": r.href, "symbol": func(id string) any { return schema.Symbols[id] },
		"published":    r.publishedEntries,
		"relativeName": func(fullName, pkg string) string { return strings.TrimPrefix(fullName, pkg+".") },
		"entry":        func(id string) indexedSymbol { return r.entries[id] }, "pkg": func(n string) *model.DocPackage { return r.packages[n] }, "file": func(n string) *model.DocFile { return r.files[n] },
		"dict": dict, "comment": commentHTML, "note": func(name string) template.HTML {
			// WKT notes are built-in Markdown sanitized by the model, never schema HTML.
			return template.HTML(schema.WKTNotes[name])
		},
		"validation": validationChips, "required": func(opts []*model.DocOption) bool {
			for _, v := range validationChips(opts) {
				if v == "required" {
					return true
				}
			}
			return false
		},
		"options": visibleOptions, "nonvalidation": nonValidationBadges, "typeLabel": typeLabel, "typeURL": r.typeURL, "repoLabel": repositoryLabel,
		"fields": r.fieldRows, "refs": groupReferences, "relation": relationLabel, "kind": func(s string) string { return strings.ReplaceAll(s, "-", " ") },
		"reserved": reservedText, "example": exampleJSON, "featureSource": featureSource, "join": strings.Join,
		"stream": func(on bool) template.HTML {
			if on {
				return `<span class="stream-keyword">stream</span> `
			}
			return ""
		},
		"sourceTree": r.sourceTree, "packageTree": r.packageTree, "homeAreas": r.homeAreas, "sourceLines": sourceLines,
		"basename": path.Base, "dirs": func(s string) []string { parts := strings.Split(s, "/"); return parts[:len(parts)-1] },
		"graph": func() []graphCard { return graphCards(buildGraph(schema)) }, "exploreEntries": r.exploreEntries,
	}
	var err error
	r.templates, err = template.New("pages").Funcs(funcs).ParseFS(pageTemplates, "templates/*.html")
	return r, err
}

type homeStat struct {
	Label string
	Value int
}

func (r *renderer) homeStats() []homeStat {
	count := 0
	for _, p := range r.schema.Packages {
		if p.Domain == "local" && p.InNav {
			count++
		}
	}
	return []homeStat{{"Packages", count}, {"Symbols", r.schema.BuildInfo.SymbolCount}, {"Files", r.schema.BuildInfo.FileCount}, {"Services", r.index.LocalServices}, {"Custom options", r.index.CustomOptions}}
}

func dict(values ...any) map[string]any {
	m := map[string]any{}
	for i := 0; i+1 < len(values); i += 2 {
		m[values[i].(string)] = values[i+1]
	}
	return m
}
func (r *renderer) fragment(name string, data any) (template.HTML, error) {
	var b bytes.Buffer
	err := r.templates.ExecuteTemplate(&b, name, data)
	return template.HTML(b.String()), err
}
func (r *renderer) href(p string) string {
	if strings.HasPrefix(p, "#") {
		return p
	}
	if u, err := url.Parse(p); err == nil && (u.IsAbs() || u.Host != "") {
		return p
	}
	return strings.TrimSuffix(r.base, "/") + "/" + strings.TrimPrefix(p, "/")
}
func (r *renderer) typeURL(ref model.TypeRef) string {
	if ref.ExternalURL != "" {
		return ref.ExternalURL
	}
	if ref.URLPath != "" {
		return r.href(ref.URLPath)
	}
	return ""
}

// commentHTML accepts only model comments sanitized by internal/markdown.
// Do not use this boundary for descriptor text, labels, URLs, or arbitrary HTML.
func commentHTML(comment *model.DocComment) template.HTML {
	if comment == nil {
		return ""
	}
	return template.HTML(comment.MarkdownHTML)
}
func repositoryLabel(raw string) string {
	u, err := url.Parse(raw)
	if err == nil {
		if u.Hostname() == "github.com" || strings.HasSuffix(u.Hostname(), ".github.com") {
			return "View on GitHub"
		}
		if u.Hostname() == "gitlab.com" || strings.HasSuffix(u.Hostname(), ".gitlab.com") {
			return "View on GitLab"
		}
	}
	return "View repository"
}
func typeLabel(f *model.DocField) string {
	if f.Cardinality == "map" && f.MapKey != nil && f.MapValue != nil {
		return "map<" + f.MapKey.Name + ", " + f.MapValue.Name + ">"
	}
	return f.Type.Name
}
func validationChips(opts []*model.DocOption) []string {
	var out []string
	for _, o := range opts {
		s := o.Semantic
		if s == nil || (s.RendererID != "validation" && s.RendererID != "cybozu.validate") {
			continue
		}
		if len(s.Badges) > 0 {
			out = append(out, s.Badges...)
		} else if s.Summary != "" {
			out = append(out, s.Summary)
		}
	}
	return out
}
func nonValidationBadges(opts []*model.DocOption) []string {
	var out []string
	for _, o := range opts {
		s := o.Semantic
		if s != nil && s.RendererID != "validation" && s.RendererID != "cybozu.validate" {
			out = append(out, s.Badges...)
		}
	}
	return out
}
func visibleOptions(opts []*model.DocOption) []*model.DocOption {
	var out []*model.DocOption
	for _, o := range opts {
		if o.Name == "deprecated" && o.Value.Kind == "scalar" {
			continue
		}
		out = append(out, o)
	}
	return out
}
func reservedText(names []string, ranges []model.ReservedRange) string {
	var out []string
	for _, v := range ranges {
		out = append(out, fmt.Sprintf("%d to %d", v.Start, v.End-1))
	}
	return strings.Join(append(out, names...), ", ")
}
func exampleJSON(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return ""
	}
	return string(b)
}
func featureSource(f model.EffectiveFeature) string {
	if f.Source == "declared" && f.Declared != "" {
		return "declared " + f.Declared
	}
	if f.Source == "inherited" {
		return "inherited from " + f.InheritedFrom
	}
	return "default for this edition"
}

type fieldRow struct {
	Field   *model.DocField
	Oneof   *model.DocOneof
	Members []*model.DocField
	Prefix  string
}

func (r *renderer) fieldRows(msg *model.DocMessage, prefix string) []fieldRow {
	out := []fieldRow{}
	emitted := map[string]bool{}
	for _, id := range msg.FieldIDs {
		f, _ := r.schema.Symbols[id].(*model.DocField)
		if f == nil || emitted[id] {
			continue
		}
		o, _ := r.schema.Symbols[f.OneofID].(*model.DocOneof)
		if o == nil {
			out = append(out, fieldRow{Field: f, Prefix: prefix})
			continue
		}
		row := fieldRow{Oneof: o, Prefix: prefix}
		for _, mid := range o.FieldIDs {
			if mf, ok := r.schema.Symbols[mid].(*model.DocField); ok {
				row.Members = append(row.Members, mf)
				emitted[mid] = true
			}
		}
		out = append(out, row)
	}
	return out
}

type referenceGroup struct {
	Kind  string
	Items []model.SymbolReference
}

func groupReferences(refs []model.SymbolReference) []referenceGroup {
	var out []referenceGroup
	positions := map[string]int{}
	for _, ref := range refs {
		i, ok := positions[ref.Kind]
		if !ok {
			i = len(out)
			positions[ref.Kind] = i
			out = append(out, referenceGroup{Kind: ref.Kind})
		}
		out[i].Items = append(out[i].Items, ref)
	}
	return out
}
func relationLabel(kind string) string {
	labels := map[string]string{"field-type": "Field type", "map-value-type": "Map value", "map-key-type": "Map key", "rpc-input": "RPC request", "rpc-output": "RPC response", "extension-target": "Extension target", "option-definition": "Option", "nested-type": "Nested type", "file-import": "Import"}
	if s := labels[kind]; s != "" {
		return s
	}
	return "Reference"
}

type sourceLine struct {
	Number int
	HTML   template.HTML
}

var protoTokens = regexp.MustCompile(`\b(syntax|edition|package|import|option|message|enum|service|rpc|returns|stream|repeated|optional|required|reserved|to|extend|oneof|map|true|false)\b|(//.*$)|("(?:\\.|[^"])*")|(\b\d+\b)`)

func sourceLines(text string) []sourceLine {
	var out []sourceLine
	for i, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line == "" {
			line = " "
		}
		escaped := template.HTMLEscapeString(line)
		// Tokenize untrusted text first, then escape each token and intervening span.
		var b strings.Builder
		end := 0
		for _, loc := range protoTokens.FindAllStringSubmatchIndex(line, -1) {
			b.WriteString(template.HTMLEscapeString(line[end:loc[0]]))
			cls := "num"
			if loc[2] >= 0 {
				cls = "text-[color:var(--accent)]"
			} else if loc[4] >= 0 {
				cls = "text-[color:var(--fg-muted)]"
			} else if loc[6] >= 0 {
				cls = "text-[color:var(--accent-2)]"
			}
			fmt.Fprintf(&b, `<span class="%s">%s</span>`, cls, template.HTMLEscapeString(line[loc[0]:loc[1]]))
			end = loc[1]
		}
		if end > 0 {
			b.WriteString(template.HTMLEscapeString(line[end:]))
			escaped = b.String()
		}
		out = append(out, sourceLine{i + 1, template.HTML(escaped)})
	}
	return out
}

type graphCard struct {
	graphNode
	Imports, ImportedBy []string
}

func graphCards(g packageGraph) []graphCard {
	byID := map[string]graphNode{}
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}
	var out []graphCard
	for _, n := range g.Nodes {
		c := graphCard{graphNode: n}
		for _, e := range g.Edges {
			if e.From == n.ID {
				c.Imports = append(c.Imports, byID[e.To].FullName)
			}
			if e.To == n.ID {
				c.ImportedBy = append(c.ImportedBy, byID[e.From].FullName)
			}
		}
		if len(c.Imports)+len(c.ImportedBy) > 0 {
			out = append(out, c)
		}
	}
	return out
}
func (r *renderer) publishedEntries(ids []string) []indexedSymbol {
	var entries []indexedSymbol
	for _, id := range ids {
		if e := r.entries[id]; e.Shard != "" {
			entries = append(entries, e)
		}
	}
	return entries
}

func (r *renderer) exploreEntries() []model.SymbolIndexEntry {
	var out []model.SymbolIndexEntry
	for _, e := range r.index.SymbolIndex {
		if e.Shard != "" {
			out = append(out, e.SymbolIndexEntry)
		}
	}
	for _, f := range r.index.Files {
		if f.HasSource {
			out = append(out, model.SymbolIndexEntry{ID: f.ID, FullName: f.FullName, Kind: "file", URLPath: f.URLPath})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].FullName < out[j].FullName })
	return out
}

func (r *renderer) page(route string, shell []byte) ([]byte, error) {
	name := "not-found"
	title := "Not found"
	var data any = r.index
	switch route {
	case "/":
		name = "home"
		title = ""
	case "/explore/":
		name = "explore"
		title = "Used-by explorer"
	case "/graph/":
		name = "graph"
		title = "Package graph"
	case "/diff/":
		name = "diff"
		title = "Schema diff"
		data = r.schema.Diff
	case "/source/":
		name = "source-index"
		title = "Source"
	default:
		if s := r.pages[route]; s != nil {
			b := model.SymbolMetadata(s)
			name = b.Kind
			title = b.FullName
			data = s
		}
	}
	content, err := r.fragment(name, data)
	if err != nil {
		return nil, err
	}
	nav, err := r.packageTree(route)
	if err != nil {
		return nil, err
	}
	fullTitle := r.opts.Title
	if fullTitle == "" {
		fullTitle = r.schema.Title
	}
	if fullTitle == "" {
		fullTitle = "Protobuf API"
	}
	if title != "" {
		fullTitle = title + " · " + fullTitle
	}
	canonical := ""
	if r.opts.SiteURL != "" {
		if root, err := url.Parse(r.opts.SiteURL); err == nil {
			if target, err := url.Parse(r.href(route)); err == nil {
				canonical = root.ResolveReference(target).String()
			}
		}
	}
	layout, err := r.fragment("layout", dict("Content", content, "Navigation", nav, "Index", r.index, "Title", r.opts.Title))
	if err != nil {
		return nil, err
	}
	// Insert trusted template output only after stamping configuration. Descriptor
	// text containing a stamping token must never be interpreted as configuration.
	text := string(shell)
	text = strings.Replace(text, "<title>__PAGE_TITLE__</title>", "<title>"+template.HTMLEscapeString(fullTitle)+"</title>", 1)
	if canonical != "" {
		head, err := r.fragment("canonical", canonical)
		if err != nil {
			return nil, err
		}
		text = strings.Replace(text, "</head>", string(head)+"</head>", 1)
	}
	return []byte(strings.Replace(text, `<div id="app"></div>`, string(layout), 1)), nil
}
