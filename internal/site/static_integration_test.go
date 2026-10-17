package site_test

import (
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymmt2005/pbschema-lens/internal/pipeline"
	"golang.org/x/net/html"
)

// These checks read the produced files, with no browser or JSON hydration. They
// catch a shell-only build, missing pages, broken fragment links, and base leaks.
func TestAcmeStaticHTMLAndLinks(t *testing.T) {
	buf, err := exec.LookPath("buf")
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatal("Buf is required")
		}
		t.Skip("Buf is required for Acme integration")
	}
	repo, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(buf, "build", "examples/acme", "-o", "-", "--as-file-descriptor-set")
	cmd.Dir = repo
	raw, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	descriptor := filepath.Join(t.TempDir(), "acme.binpb")
	if err := os.WriteFile(descriptor, raw, 0600); err != nil {
		t.Fatal(err)
	}
	for _, base := range []string{"/", "/pbschema-lens/"} {
		t.Run(base, func(t *testing.T) {
			out := filepath.Join(t.TempDir(), "site")
			result, err := pipeline.Build(pipeline.Request{CWD: repo, Input: descriptor, ConfigFile: "examples/acme/pbschema-lens.yaml", Out: out, Base: base, SourceDir: "examples/acme/proto"})
			if err != nil {
				t.Fatal(err)
			}
			pages := map[string]map[string]bool{}
			links := map[string][]string{}
			titles := map[string]string{}
			err = filepath.WalkDir(out, func(p string, d os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if d.IsDir() || !strings.HasSuffix(p, ".html") {
					return nil
				}
				data, err := os.ReadFile(p)
				if err != nil {
					return err
				}
				doc, err := html.Parse(strings.NewReader(string(data)))
				if err != nil {
					return err
				}
				rel, _ := filepath.Rel(out, p)
				route := base + strings.TrimSuffix(filepath.ToSlash(rel), "index.html")
				ids := map[string]bool{}
				hasHeading := false
				var walk func(*html.Node)
				walk = func(n *html.Node) {
					if n.Type == html.ElementNode {
						if n.Data == "title" {
							var text strings.Builder
							var readText func(*html.Node)
							readText = func(node *html.Node) {
								if node.Type == html.TextNode {
									text.WriteString(node.Data)
								}
								for c := node.FirstChild; c != nil; c = c.NextSibling {
									readText(c)
								}
							}
							readText(n)
							titles[route] = text.String()
						}
						if n.Data == "h1" {
							hasHeading = true
						}
						for _, a := range n.Attr {
							if a.Key == "id" {
								if ids[a.Val] {
									t.Errorf("%s: duplicate id %q", route, a.Val)
								}
								ids[a.Val] = true
							}
							if a.Key == "href" {
								links[route] = append(links[route], a.Val)
							}
						}
					}
					for c := n.FirstChild; c != nil; c = c.NextSibling {
						walk(c)
					}
				}
				walk(doc)
				if !hasHeading {
					t.Errorf("%s has no static heading", route)
				}
				pages[route] = ids
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range result.Model.SymbolIndex {
				u, err := url.Parse(base + strings.TrimPrefix(e.URLPath, "/"))
				if err != nil {
					t.Fatal(err)
				}
				if _, ok := pages[u.Path]; !ok {
					t.Errorf("symbol %s has no static document at %s", e.ID, u.Path)
				}
				// A generic not-found document also has an h1 and valid links.
				// Assert the identity of each top-level symbol page as well.
				if e.Kind != "field" && e.Kind != "oneof" && e.Kind != "enum-value" {
					want := e.FullName + " · " + result.Model.Title
					if titles[u.Path] != want {
						t.Errorf("%s: title = %q, want %q", u.Path, titles[u.Path], want)
					}
				}

			}
			for from, hrefs := range links {
				source, _ := url.Parse("https://static.test" + from)
				for _, href := range hrefs {
					u, err := url.Parse(href)
					if err != nil {
						t.Errorf("%s: invalid href %q", from, href)
						continue
					}
					target := source.ResolveReference(u)
					if target.Host != "static.test" || target.Scheme != "https" {
						continue
					}
					if !strings.HasPrefix(target.Path, base) {
						t.Errorf("%s: link escapes base: %s", from, href)
						continue
					}
					ids, ok := pages[target.Path]
					if !ok {
						rel := strings.TrimPrefix(target.Path, base)
						if _, err := os.Stat(filepath.Join(out, filepath.FromSlash(rel))); err != nil {
							t.Errorf("%s: missing target %s", from, href)
						}
						continue
					}
					if target.Fragment != "" && !ids[target.Fragment] {
						t.Errorf("%s: missing fragment %s", from, href)
					}
				}
			}
		})
	}
}
