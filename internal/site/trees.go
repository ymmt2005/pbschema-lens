package site

import (
	"html/template"
	"sort"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/model"
)

type navNode struct {
	Segment, Path, URL           string
	Active, Open, File           bool
	Children                     []*navNode
	Packages, Services, Messages int
}

func insertNode(nodes *[]*navNode, parts []string, delimiter, prefix string, item *navNode) {
	if len(parts) == 0 {
		return
	}
	segment := parts[0]
	p := segment
	if prefix != "" {
		p = prefix + delimiter + segment
	}
	var n *navNode
	for _, s := range *nodes {
		if s.Segment == segment {
			n = s
			break
		}
	}
	if n == nil {
		n = &navNode{Segment: segment, Path: p}
		*nodes = append(*nodes, n)
	}
	if len(parts) == 1 {
		n.URL = item.URL
		n.File = item.File
		n.Packages = item.Packages
		n.Services = item.Services
		n.Messages = item.Messages
	} else {
		insertNode(&n.Children, parts[1:], delimiter, p, item)
	}
}
func sortTree(nodes []*navNode, active, delimiter string) {
	sort.Slice(nodes, func(i, j int) bool {
		if delimiter == "/" && nodes[i].File != nodes[j].File {
			return !nodes[i].File
		}
		return naturalLess(nodes[i].Segment, nodes[j].Segment)
	})
	for _, n := range nodes {
		n.Active = active != "" && n.Path == active
		n.Open = active != "" && strings.HasPrefix(active, n.Path+delimiter)
		sortTree(n.Children, active, delimiter)
	}
}

// Compare numeric runs by value without overflowing for arbitrarily long names.
func naturalLess(a, b string) bool {
	for len(a) > 0 && len(b) > 0 {
		if a[0] >= '0' && a[0] <= '9' && b[0] >= '0' && b[0] <= '9' {
			i, j := 0, 0
			for i < len(a) && a[i] >= '0' && a[i] <= '9' {
				i++
			}
			for j < len(b) && b[j] >= '0' && b[j] <= '9' {
				j++
			}
			x, y := strings.TrimLeft(a[:i], "0"), strings.TrimLeft(b[:j], "0")
			if len(x) != len(y) {
				return len(x) < len(y)
			}
			if x != y {
				return x < y
			}
			a, b = a[i:], b[j:]
			continue
		}
		if a[0] != b[0] {
			return a[0] < b[0]
		}
		a, b = a[1:], b[1:]
	}
	return a < b
}
func (r *renderer) packageNodes(active string) []*navNode {
	var nodes []*navNode
	for _, p := range r.schema.Packages {
		if p.Domain == "local" && p.InNav {
			insertNode(&nodes, strings.Split(p.FullName, "."), ".", "", &navNode{URL: p.URLPath, Packages: 1, Services: len(p.ServiceIDs), Messages: len(p.MessageIDs)})
		}
	}
	sortTree(nodes, active, ".")
	return nodes
}
func (r *renderer) packageTree(route string) (template.HTML, error) {
	active := ""
	if s := r.pages[route]; s != nil {
		active = model.SymbolMetadata(s).PackageName
	}
	return r.fragment("package-tree", r.packageNodes(active))
}
func (r *renderer) sourceTree(active string) (template.HTML, error) {
	var nodes []*navNode
	for _, f := range r.schema.Files {
		if f.GeneratePage && f.SourceText != "" {
			insertNode(&nodes, strings.Split(f.FullName, "/"), "/", "", &navNode{URL: f.URLPath, File: true})
		}
	}
	sortTree(nodes, active, "/")
	return r.fragment("source-tree", nodes)
}
func rollup(n *navNode) {
	for _, c := range n.Children {
		rollup(c)
		n.Packages += c.Packages
		n.Services += c.Services
		n.Messages += c.Messages
	}
}
func (r *renderer) homeAreas() (template.HTML, error) {
	nodes := r.packageNodes("")
	for _, n := range nodes {
		rollup(n)
	}
	rows := nodes
	if len(nodes) == 1 {
		n := nodes[0]
		for len(n.Children) == 1 {
			n = n.Children[0]
		}
		if len(n.Children) > 0 && len(n.Children) <= 12 {
			rows = n.Children
		} else {
			rows = []*navNode{n}
		}
	} else if len(nodes) > 12 {
		n := &navNode{Children: nodes}
		for _, c := range nodes {
			n.Packages += c.Packages
			n.Services += c.Services
			n.Messages += c.Messages
		}
		rows = []*navNode{n}
	}
	return r.fragment("home-areas", rows)
}
