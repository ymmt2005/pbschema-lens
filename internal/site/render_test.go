package site

import (
	"strings"
	"testing"

	"github.com/ymmt2005/pbschema-lens/internal/markdown"
	"github.com/ymmt2005/pbschema-lens/internal/model"
	"golang.org/x/net/html"
)

func testSymbol(s any, id, kind, name, route string) {
	b := model.SymbolMetadata(s)
	b.ID = id
	b.Kind = kind
	b.FullName = name
	b.ShortName = name
	b.URLPath = route
	b.GeneratePage = true
	b.Domain = "local"
}
func renderFixture() *model.SchemaModel {
	m := &model.DocMessage{}
	testSymbol(m, "m", "message", "demo.User", "/reference/messages/demo.User/")
	m.ShortName = "User"
	m.PackageName = "demo"
	m.FileName = "demo/user.proto"
	m.FieldIDs = []string{"f", "g"}
	m.OneofIDs = []string{"o"}
	m.NestedMessageIDs = []string{"nested"}
	m.ReservedRanges = []model.ReservedRange{{Start: 10, End: 20}}
	m.ReservedNames = []string{"old"}
	m.ExampleJSON = map[string]any{"id": "x"}
	m.Comments = &model.DocComment{MarkdownHTML: markdown.RenderSafe(`A **user**. <script>alert(1)</script>`)}
	m.Features = []model.EffectiveFeature{{Name: "field_presence", Effective: "EXPLICIT", Source: "edition-default"}}
	f := &model.DocField{Number: 1, JSONName: "email", Presence: "EXPLICIT", Cardinality: "optional", Type: model.TypeRef{Kind: "scalar", Name: "string"}, OneofID: "o"}
	testSymbol(f, "f", "field", "email", m.URLPath)
	f.Anchor = "email"
	f.GeneratePage = false
	f.Options = []*model.DocOption{{TextProto: `string: { min_len: 1 }`, Semantic: &model.Semantic{RendererID: "validation", Badges: []string{"min_len: 1"}}}}
	g := &model.DocField{Number: 2, JSONName: "name", Presence: "EXPLICIT", Cardinality: "optional", Type: f.Type, OneofID: "o"}
	testSymbol(g, "g", "field", "name", m.URLPath)
	g.Anchor = "name"
	g.GeneratePage = false
	o := &model.DocOneof{FieldIDs: []string{"f", "g"}}
	testSymbol(o, "o", "oneof", "contact", m.URLPath)
	o.GeneratePage = false
	o.Anchor = "contact"
	o.Options = []*model.DocOption{{Semantic: &model.Semantic{RendererID: "cybozu.validate", Badges: []string{"required"}}}}
	n := &model.DocMessage{ParentID: "m"}
	testSymbol(n, "nested", "message", "demo.User.Preferences", "/reference/messages/demo.User.Preferences/")
	p := &model.DocPackage{MessageIDs: []string{"m", "nested"}, ServiceIDs: []string{"s"}}
	testSymbol(p, "p", "package", "demo", "/reference/packages/demo/")
	p.InNav = true
	file := &model.DocFile{Syntax: "proto3", SourceText: "message User {\n // <script>alert(1)</script>\n string email = 1;\n}"}
	testSymbol(file, "file", "file", "demo/user.proto", "/source/demo/user.proto/")
	file.PackageName = "demo"
	m.SourceLink = &model.SourceLink{URL: file.URLPath + "#L1"}
	svc := &model.DocService{MethodIDs: []string{"rpc"}}
	testSymbol(svc, "s", "service", "demo.Users", "/reference/services/demo.Users/")
	svc.ShortName = "Users"
	rpc := &model.DocMethod{ParentID: "s", Input: model.TypeRef{ID: "m", Name: "User", URLPath: m.URLPath}, Output: model.TypeRef{ID: "m", Name: "User", URLPath: m.URLPath}, ServerStreaming: true}
	testSymbol(rpc, "rpc", "method", "demo.Users.Get", "/reference/methods/demo.Users.Get/")
	rpc.ShortName = "Get"
	en := &model.DocEnum{ValueIDs: []string{"v"}, Open: true}
	testSymbol(en, "e", "enum", "demo.State", "/reference/enums/demo.State/")
	ev := &model.DocEnumValue{Number: 0}
	testSymbol(ev, "v", "enum-value", "UNKNOWN", en.URLPath)
	ev.Anchor = "unknown"
	ev.GeneratePage = false
	ext := &model.DocExtension{Number: 50001, Type: f.Type, OptionTarget: "message", Declaration: "extend MessageOptions {}"}
	testSymbol(ext, "ext", "extension", "demo.pii", "/reference/extensions/demo.pii/")
	m.Options = []*model.DocOption{{Name: "pii", FullName: "demo.pii", DefinitionID: "ext", Extension: true, TextProto: "(demo.pii) = true"}, {Name: "hidden", FullName: "vendor.hidden", DefinitionID: "missing", TextProto: "hidden = true"}}
	m.ReferencedBy = []model.SymbolReference{{FromID: "rpc", ToID: "m", Kind: "rpc-input"}}
	symbols := map[string]any{"m": m, "nested": n, "f": f, "g": g, "o": o, "p": p, "file": file, "s": svc, "rpc": rpc, "e": en, "v": ev, "ext": ext}
	schema := &model.SchemaModel{Title: "Demo", Symbols: symbols, Packages: []*model.DocPackage{p}, Messages: []*model.DocMessage{m, n}, Files: []*model.DocFile{file}, Fields: []*model.DocField{f, g}, Oneofs: []*model.DocOneof{o}, Services: []*model.DocService{svc}, Methods: []*model.DocMethod{rpc}, Enums: []*model.DocEnum{en}, EnumValues: []*model.DocEnumValue{ev}, Extensions: []*model.DocExtension{ext}, Diff: &model.SchemaDiff{AgainstLabel: "previous", Added: []model.SymbolChange{{Kind: "message", FullName: "demo.New", Details: []string{"created"}}}}}
	for _, id := range []string{"m", "nested", "p", "s", "rpc", "e", "ext", "f", "g", "o", "v"} {
		b := model.SymbolMetadata(symbols[id])
		u := b.URLPath
		if b.Anchor != "" {
			u += "#" + b.Anchor
		}
		schema.SymbolIndex = append(schema.SymbolIndex, model.SymbolIndexEntry{ID: id, FullName: b.FullName, Name: b.ShortName, Kind: b.Kind, URLPath: u})
	}
	return schema
}
func TestStaticPagesContainContentAndAnchors(t *testing.T) {
	schema := renderFixture()
	for _, prefix := range []string{"/", "/pbschema-lens/"} {
		t.Run(prefix, func(t *testing.T) {
			r, err := newRenderer(schema, Options{Base: prefix, Title: "Demo", SiteURL: "https://docs.example.test"})
			if err != nil {
				t.Fatal(err)
			}
			shell := []byte(`<html><head><title>__PAGE_TITLE__</title></head><body><div id="app"></div></body></html>`)
			checks := map[string][]string{
				"/":                                  {">Demo</h1>", "home-area", "1 package"},
				"/reference/messages/demo.User/":     {">User</h1>", "<strong>user</strong>", `id="email"`, `id="contact"`, "oneof-member", "Exactly one of", "min_len: 1", "JSON name:", "EXPLICIT", "Effective features", "default for this edition", "10 to 19, old", "Example JSON", "RPC request", `href="` + strings.TrimSuffix(prefix, "/") + `/reference/messages/demo.User.Preferences/"`, "Defined by", `href="` + strings.TrimSuffix(prefix, "/") + `/reference/extensions/demo.pii/"`},
				"/reference/services/demo.Users/":    {"Streaming", "stream-chip"},
				"/reference/methods/demo.Users.Get/": {"stream-keyword", `id="request-email"`, `id="response-email"`, "RPC on"},
				"/reference/enums/demo.State/":       {`id="unknown"`, "Open enum"},
				"/reference/extensions/demo.pii/":    {"50001", "message option"},
				"/source/demo/user.proto/":           {`id="L1"`, "&lt;script&gt;", "source-tree-file is-active", "open", "user.proto"},
				"/diff/":                             {"Compared against previous", "demo.New", "created"},
				"/404.html":                          {"Page not found", "Back to the catalog"},
			}
			for route, want := range checks {
				raw, err := r.page(route, shell)
				if err != nil {
					t.Fatalf("%s: %v", route, err)
				}
				s := string(raw)
				for _, text := range want {
					if !strings.Contains(s, text) {
						t.Errorf("%s missing %q", route, text)
					}
				}
				if strings.Contains(s, "<script>alert") || strings.Contains(s, "__PAGE_TITLE__") {
					t.Errorf("unsafe or unstamped output on %s", route)
				}
				doc, err := html.Parse(strings.NewReader(s))
				if err != nil {
					t.Fatal(err)
				}
				ids := map[string]bool{}
				walkHTML(doc, func(n *html.Node) {
					for _, a := range n.Attr {
						if a.Key == "id" {
							if ids[a.Val] {
								t.Errorf("%s duplicate id %q", route, a.Val)
							}
							ids[a.Val] = true
						}
					}
				})
			}
		})
	}
}
func walkHTML(n *html.Node, fn func(*html.Node)) {
	fn(n)
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walkHTML(c, fn)
	}
}
func TestTemplateEscapesSchemaAndUnsafeURLs(t *testing.T) {
	s := renderFixture()
	m := s.Messages[0]
	m.ShortName = `<img src=x onerror=alert(1)>`
	m.SourceLink.URL = "javascript:alert(1)"
	r, err := newRenderer(s, Options{Title: `</title><script>alert(1)</script>`})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := r.page(m.URLPath, []byte(`<title>__PAGE_TITLE__</title><div id="app"></div>`))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, "<img") || strings.Contains(text, "<script>") || strings.Contains(text, `href="javascript:`) {
		t.Fatal("unescaped schema text or unsafe URL")
	}
	if !strings.Contains(text, "&lt;img") {
		t.Fatal("escaped symbol missing")
	}
}
func TestStaticPageTokenTextIsNotStamped(t *testing.T) {
	s := renderFixture()
	m := s.Messages[0]
	m.ShortName = "__TITLE__ __PAGE_TITLE__ __DATA_BASE__"
	r, err := newRenderer(s, Options{Title: "Demo"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := r.page(m.URLPath, []byte(`<title>__PAGE_TITLE__</title><div id="app"></div>`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), ">__TITLE__ __PAGE_TITLE__ __DATA_BASE__</h1>") {
		t.Fatal("schema text treated as configuration")
	}
}

func TestNavigationTreesOpenOnlyCurrentAncestors(t *testing.T) {
	schema := renderFixture()
	for _, name := range []string{"acme.user.v1", "acme.user.v2", "acme.billing.v1", "acme.security"} {
		p := &model.DocPackage{}
		testSymbol(p, name, "package", name, "/reference/packages/"+name+"/")
		p.InNav = true
		schema.Packages = append(schema.Packages, p)
	}
	r, err := newRenderer(schema, Options{})
	if err != nil {
		t.Fatal(err)
	}
	closed, err := r.fragment("package-tree", r.packageNodes(""))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(closed), " open") {
		t.Fatal("inactive folders expanded")
	}
	active, err := r.fragment("package-tree", r.packageNodes("acme.user.v1"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := html.Parse(strings.NewReader(string(active)))
	if err != nil {
		t.Fatal(err)
	}
	open := 0
	walkHTML(doc, func(n *html.Node) {
		if n.Data == "details" {
			for _, a := range n.Attr {
				if a.Key == "open" {
					open++
				}
			}
		}
	})
	if open != 2 {
		t.Fatalf("open folders = %d, want 2", open)
	}
	if !strings.Contains(string(active), `aria-current="page"`) {
		t.Fatal("active package not marked")
	}
	for _, pair := range [][2]string{{"v2", "v10"}, {"v99999999999999999999", "v100000000000000000000"}} {
		if !naturalLess(pair[0], pair[1]) {
			t.Errorf("incorrect numeric order: %v", pair)
		}
	}
}
func TestOptionFilteringAndHiddenDefinition(t *testing.T) {
	s := renderFixture()
	r, err := newRenderer(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	opts := []*model.DocOption{{Name: "deprecated", Value: model.OptionValue{Kind: "scalar"}, TextProto: "deprecated = true"}, {Name: "hidden", FullName: "vendor.hidden", DefinitionID: "missing", TextProto: `unsafe <tag>`}}
	result, err := r.fragment("options", opts)
	if err != nil {
		t.Fatal(err)
	}
	text := string(result)
	if strings.Contains(text, "deprecated = true") || strings.Contains(text, "<tag>") || strings.Contains(text, "<a ") {
		t.Fatal("invalid option rendering", text)
	}
	if !strings.Contains(text, "vendor.hidden") || !strings.Contains(text, "unsafe &lt;tag&gt;") {
		t.Fatal("option text missing", text)
	}
}
func TestNoWellKnownNavigationWhenDisabled(t *testing.T) {
	s := renderFixture()
	p := &model.DocPackage{}
	testSymbol(p, "wkt", "package", "google.protobuf", "/reference/packages/google.protobuf/")
	p.Domain = "well-known"
	p.GeneratePage = false
	s.Packages = append(s.Packages, p)
	r, err := newRenderer(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := r.page("/", []byte(`<div id="app"></div>`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "Protobuf standard library") {
		t.Fatal("disabled WKT navigation remains")
	}
}

func TestPackageListsPreserveNestedNamesAndEmptyStates(t *testing.T) {
	s := renderFixture()
	s.Messages[1].ShortName = "Preferences"
	for i := range s.SymbolIndex {
		if s.SymbolIndex[i].ID == "nested" {
			s.SymbolIndex[i].Name = "Preferences"
		}
	}
	s.Packages[0].ExtensionIDs = []string{"ext"}
	s.Extensions[0].ShortName = "pii"
	for i := range s.SymbolIndex {
		if s.SymbolIndex[i].ID == "ext" {
			s.SymbolIndex[i].Name = "pii"
		}
	}
	r, err := newRenderer(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := r.fragment("package", s.Packages[0])
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{">User.Preferences</a>", ">demo.pii</a>", "No enums in this package.", "columns-1 sm:columns-2"} {
		if !strings.Contains(text, want) {
			t.Errorf("package listing missing %q", want)
		}
	}
}
func TestNoScriptMobileNavigationIncludesStandardLibraryAndDiff(t *testing.T) {
	s := renderFixture()
	p := &model.DocPackage{}
	testSymbol(p, "wkt", "package", "google.protobuf", "/reference/packages/google.protobuf/")
	p.Domain = "well-known"
	s.Packages = append(s.Packages, p)
	r, err := newRenderer(s, Options{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := r.page("/", []byte(`<div id="app"></div>`))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := html.ParseWithOptions(strings.NewReader(string(raw)), html.ParseOptionEnableScripting(false))
	if err != nil {
		t.Fatal(err)
	}
	var mobile *html.Node
	walkHTML(doc, func(n *html.Node) {
		if n.Data == "nav" {
			for _, a := range n.Attr {
				if a.Key == "aria-label" && a.Val == "Mobile navigation" {
					mobile = n
				}
			}
		}
	})
	if mobile == nil {
		t.Fatal("missing mobile navigation fallback")
	}
	found := map[string]bool{}
	walkHTML(mobile, func(n *html.Node) {
		for _, a := range n.Attr {
			if a.Key == "href" {
				found[a.Val] = true
			}
		}
	})
	for _, want := range []string{"/reference/packages/google.protobuf/", "/diff/", "/source/", "/explore/"} {
		if !found[want] {
			t.Errorf("mobile fallback missing %s", want)
		}
	}
}
