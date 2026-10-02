package site

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ymmt2005/pbschema-lens/internal/model"
)

// The browser loads these files instead of one model.json.
// index.json is the nav and search catalog. Symbol and source filenames are
// SHA-256 keys stored on the index, so a long protobuf name cannot exceed a
// filesystem component limit. Diff, references, the package graph, and comment
// search text stay in their own files.

type siteIndex struct {
	Title         string            `json:"title"`
	BuildInfo     model.BuildInfo   `json:"buildInfo"`
	Packages      []packageCard     `json:"packages"`
	Files         []fileCard        `json:"files"`
	SymbolIndex   []indexedSymbol   `json:"symbolIndex"`
	WKTNotes      map[string]string `json:"wktNotes"`
	HasDiff       bool              `json:"hasDiff"`
	HasSource     bool              `json:"hasSource"`
	LocalServices int               `json:"localServices"`
	CustomOptions int               `json:"customOptions"`
}

type packageCard struct {
	ID           string `json:"id"`
	FullName     string `json:"fullName"`
	URLPath      string `json:"urlPath"`
	Domain       string `json:"domain"`
	GeneratePage bool   `json:"generatePage"`
	InNav        bool   `json:"inNav"`
	Services     int    `json:"services"`
	Messages     int    `json:"messages"`
	Enums        int    `json:"enums"`
	Extensions   int    `json:"extensions"`
}

type fileCard struct {
	ID           string `json:"id"`
	FullName     string `json:"fullName"`
	URLPath      string `json:"urlPath"`
	Syntax       string `json:"syntax"`
	Edition      string `json:"edition,omitempty"`
	GeneratePage bool   `json:"generatePage"`
	HasSource    bool   `json:"hasSource"`
	SourceShard  string `json:"sourceShard,omitempty"`
}

type indexedSymbol struct {
	model.SymbolIndexEntry
	Shard string `json:"shard,omitempty"`
}

type symbolFile struct {
	Symbol  any            `json:"symbol"`
	Related map[string]any `json:"related"`
}

type packageGraph struct {
	Nodes []graphNode `json:"nodes"`
	Edges []graphEdge `json:"edges"`
}

type graphNode struct {
	ID           string `json:"id"`
	FullName     string `json:"fullName"`
	URLPath      string `json:"urlPath"`
	GeneratePage bool   `json:"generatePage"`
}

type graphEdge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Public bool   `json:"public"`
}

func writeModel(out string, schema *model.SchemaModel, fullText bool) error {
	root := filepath.Join("assets", "model")
	if err := writeJSON(out, filepath.Join(root, "index.json"), buildIndex(schema)); err != nil {
		return err
	}
	if err := writeJSON(out, filepath.Join(root, "graph.json"), buildGraph(schema)); err != nil {
		return err
	}
	if err := writeJSON(out, filepath.Join(root, "references.json"), collectReferences(schema)); err != nil {
		return err
	}
	if fullText {
		if err := writeJSON(out, filepath.Join(root, "comments.json"), commentIndex(schema)); err != nil {
			return err
		}
	}
	if schema.Diff != nil {
		if err := writeJSON(out, filepath.Join(root, "diff.json"), schema.Diff); err != nil {
			return err
		}
	}
	for _, id := range pageSymbolIDs(schema) {
		name := shardKey(id) + ".json"
		if err := writeJSON(out, filepath.Join(root, "symbols", name), symbolPayload(schema, id)); err != nil {
			return err
		}
	}
	for _, file := range schema.Files {
		if file.SourceText == "" || !file.GeneratePage {
			continue
		}
		name := shardKey(file.FullName) + ".json"
		if err := writeJSON(out, filepath.Join(root, "source", name), file); err != nil {
			return err
		}
	}
	return nil
}

// shardKey is a fixed-size filename for a symbol id or proto path.
// The site index stores this key so the browser does not encode names itself.
func shardKey(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func buildIndex(schema *model.SchemaModel) siteIndex {
	index := siteIndex{
		Title:       schema.Title,
		BuildInfo:   schema.BuildInfo,
		Packages:    []packageCard{},
		Files:       []fileCard{},
		SymbolIndex: indexSymbols(schema),
		WKTNotes:    schema.WKTNotes,
		HasDiff:     schema.Diff != nil,
	}
	if index.SymbolIndex == nil {
		index.SymbolIndex = []indexedSymbol{}
	}
	if index.WKTNotes == nil {
		index.WKTNotes = map[string]string{}
	}
	for _, pkg := range schema.Packages {
		index.Packages = append(index.Packages, packageCard{
			ID: pkg.ID, FullName: pkg.FullName, URLPath: pkg.URLPath, Domain: pkg.Domain,
			GeneratePage: pkg.GeneratePage, InNav: pkg.InNav,
			Services: len(pkg.ServiceIDs), Messages: len(pkg.MessageIDs),
			Enums: len(pkg.EnumIDs), Extensions: len(pkg.ExtensionIDs),
		})
	}
	for _, file := range schema.Files {
		if !file.GeneratePage {
			continue
		}
		hasSource := file.SourceText != ""
		if hasSource {
			index.HasSource = true
		}
		card := fileCard{
			ID: file.ID, FullName: file.FullName, URLPath: file.URLPath,
			Syntax: file.Syntax, Edition: file.Edition,
			GeneratePage: true, HasSource: hasSource,
		}
		if hasSource {
			card.SourceShard = shardKey(file.FullName)
		}
		index.Files = append(index.Files, card)
	}
	for _, svc := range schema.Services {
		if svc.Domain == "local" {
			index.LocalServices++
		}
	}
	for _, ext := range schema.Extensions {
		if ext.OptionTarget != "" {
			index.CustomOptions++
		}
	}
	return index
}

func indexSymbols(schema *model.SchemaModel) []indexedSymbol {
	pages := map[string]bool{}
	for _, id := range pageSymbolIDs(schema) {
		pages[id] = true
	}
	out := make([]indexedSymbol, 0, len(schema.SymbolIndex))
	for _, entry := range schema.SymbolIndex {
		item := indexedSymbol{SymbolIndexEntry: entry}
		if pages[entry.ID] {
			item.Shard = shardKey(entry.ID)
		}
		out = append(out, item)
	}
	return out
}

func pageSymbolIDs(schema *model.SchemaModel) []string {
	var ids []string
	add := func(id string, page bool) {
		if page {
			ids = append(ids, id)
		}
	}
	for _, item := range schema.Packages {
		add(item.ID, item.GeneratePage)
	}
	for _, item := range schema.Messages {
		add(item.ID, item.GeneratePage)
	}
	for _, item := range schema.Enums {
		add(item.ID, item.GeneratePage)
	}
	for _, item := range schema.Services {
		add(item.ID, item.GeneratePage)
	}
	for _, item := range schema.Methods {
		add(item.ID, item.GeneratePage)
	}
	for _, item := range schema.Extensions {
		add(item.ID, item.GeneratePage)
	}
	sort.Strings(ids)
	return ids
}

func symbolPayload(schema *model.SchemaModel, id string) symbolFile {
	related := map[string]any{}
	switch sym := schema.Symbols[id].(type) {
	case *model.DocMessage:
		putIDs(schema, related, sym.FieldIDs)
		putIDs(schema, related, sym.OneofIDs)
	case *model.DocEnum:
		putIDs(schema, related, sym.ValueIDs)
	case *model.DocService:
		putIDs(schema, related, sym.MethodIDs)
	case *model.DocMethod:
		addMessageTree(schema, related, sym.Input.ID)
		addMessageTree(schema, related, sym.Output.ID)
	}
	return symbolFile{Symbol: schema.Symbols[id], Related: related}
}

func putIDs(schema *model.SchemaModel, related map[string]any, ids []string) {
	for _, id := range ids {
		if sym := schema.Symbols[id]; sym != nil {
			related[id] = sym
		}
	}
}

func addMessageTree(schema *model.SchemaModel, related map[string]any, id string) {
	if id == "" {
		return
	}
	sym := schema.Symbols[id]
	msg, ok := sym.(*model.DocMessage)
	if !ok {
		return
	}
	related[id] = msg
	putIDs(schema, related, msg.FieldIDs)
	putIDs(schema, related, msg.OneofIDs)
}

func commentIndex(schema *model.SchemaModel) map[string]string {
	out := map[string]string{}
	for _, entry := range schema.SymbolIndex {
		text := strings.TrimSpace(commentText(schema.Symbols[entry.ID]))
		if text != "" {
			out[entry.ID] = text
		}
	}
	return out
}

func commentText(symbol any) string {
	switch sym := symbol.(type) {
	case *model.DocPackage:
		return plainComment(sym.Comments)
	case *model.DocFile:
		return plainComment(sym.Comments)
	case *model.DocMessage:
		return plainComment(sym.Comments)
	case *model.DocField:
		return plainComment(sym.Comments)
	case *model.DocOneof:
		return plainComment(sym.Comments)
	case *model.DocEnum:
		return plainComment(sym.Comments)
	case *model.DocEnumValue:
		return plainComment(sym.Comments)
	case *model.DocService:
		return plainComment(sym.Comments)
	case *model.DocMethod:
		return plainComment(sym.Comments)
	case *model.DocExtension:
		return plainComment(sym.Comments)
	default:
		return ""
	}
}

func plainComment(comment *model.DocComment) string {
	if comment == nil {
		return ""
	}
	parts := append([]string{}, comment.Detached...)
	parts = append(parts, comment.Leading, comment.Trailing)
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func buildGraph(schema *model.SchemaModel) packageGraph {
	graph := packageGraph{Nodes: []graphNode{}, Edges: []graphEdge{}}
	pkgs := map[string]*model.DocPackage{}
	for _, pkg := range schema.Packages {
		pkgs[pkg.FullName] = pkg
		graph.Nodes = append(graph.Nodes, graphNode{
			ID: pkg.ID, FullName: pkg.FullName, URLPath: pkg.URLPath, GeneratePage: pkg.GeneratePage,
		})
	}
	sort.Slice(graph.Nodes, func(i, j int) bool { return graph.Nodes[i].FullName < graph.Nodes[j].FullName })
	type edgeKey struct{ from, to string }
	edges := map[edgeKey]bool{}
	for _, file := range schema.Files {
		from := packageID(pkgs, file.PackageName)
		if from == "" {
			continue
		}
		public := map[string]bool{}
		for _, id := range file.PublicDependencyIDs {
			public[id] = true
		}
		for _, depID := range file.DependencyIDs {
			dep, _ := schema.Symbols[depID].(*model.DocFile)
			if dep == nil {
				continue
			}
			to := packageID(pkgs, dep.PackageName)
			if to == "" || to == from {
				continue
			}
			key := edgeKey{from, to}
			if public[depID] {
				edges[key] = true
			} else if _, ok := edges[key]; !ok {
				edges[key] = false
			}
		}
	}
	for key, isPublic := range edges {
		graph.Edges = append(graph.Edges, graphEdge{From: key.from, To: key.to, Public: isPublic})
	}
	sort.Slice(graph.Edges, func(i, j int) bool {
		if graph.Edges[i].From == graph.Edges[j].From {
			return graph.Edges[i].To < graph.Edges[j].To
		}
		return graph.Edges[i].From < graph.Edges[j].From
	})
	return graph
}

func packageID(pkgs map[string]*model.DocPackage, packageName string) string {
	if packageName == "" {
		packageName = "(unnamed)"
	}
	pkg := pkgs[packageName]
	if pkg == nil {
		return ""
	}
	return pkg.ID
}

func writeJSON(out, name string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeFile(out, name, raw)
}
