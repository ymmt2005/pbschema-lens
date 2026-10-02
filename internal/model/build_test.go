package model

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymmt2005/pbschema-lens/internal/classify"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestEmptyCollectionsMarshalAsArrays(t *testing.T) {
	fd := &descriptorpb.FileDescriptorProto{
		Name:    proto.String("demo.proto"),
		Package: proto.String("demo"),
		Syntax:  proto.String("proto3"),
		MessageType: []*descriptorpb.DescriptorProto{{
			Name: proto.String("Empty"),
		}},
	}
	files, err := protodesc.NewFiles(&descriptorpb.FileDescriptorSet{File: []*descriptorpb.FileDescriptorProto{fd}})
	if err != nil {
		t.Fatal(err)
	}
	model, err := Build(files, BuildOptions{Title: "demo", InputLabel: "demo.proto"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"services", "methods", "enums", "extensions", "fields", "oneofs"} {
		value, ok := decoded[key].([]any)
		if !ok {
			t.Fatalf("%s marshaled as %T, want an array", key, decoded[key])
		}
		if len(value) != 0 {
			t.Fatalf("%s = %v", key, value)
		}
	}
}

func TestProto2RequiredAliasExtension(t *testing.T) {
	model := buildDir(t, filepath.Join(root(t), "fixtures/proto2"), BuildOptions{Title: "test", InputLabel: "proto2"})
	msg := findMessage(model, "fixtures.proto2.LegacyUser")
	if msg == nil {
		t.Fatal("missing LegacyUser")
	}
	id := findField(model, "fixtures.proto2.LegacyUser.id")
	if id == nil || id.Cardinality != "required" {
		t.Fatalf("id cardinality %+v", id)
	}
	ext := findExt(model, "fixtures.proto2.extra_id")
	if ext == nil || ext.Number != 100 {
		t.Fatalf("extension %+v", ext)
	}
	state := findEnum(model, "fixtures.proto2.LegacyState")
	if state == nil || !state.AllowAlias {
		t.Fatalf("alias %+v", state)
	}
}

func TestCustomOptions(t *testing.T) {
	model := buildDir(t, filepath.Join(root(t), "fixtures/options"), BuildOptions{Title: "test", InputLabel: "options"})
	field := findField(model, "fixtures.options.Item.secret")
	if field == nil {
		t.Fatal("missing secret")
	}
	found := false
	for _, option := range field.Options {
		if strings.Contains(option.FullName, "sensitive") {
			found = true
		}
	}
	if !found {
		for _, option := range field.Options {
			t.Logf("option name=%s full=%s ext=%v text=%s", option.Name, option.FullName, option.Extension, option.TextProto)
		}
		t.Fatal("sensitive option missing")
	}
	var def *DocExtension
	for _, ext := range model.Extensions {
		if strings.HasSuffix(ext.FullName, "sensitive") {
			def = ext
		}
	}
	if def == nil || def.OptionTarget != "field" || len(def.ReferencedBy) == 0 {
		t.Fatalf("definition %+v", def)
	}
	if problems := referenceProblems(model); len(problems) > 0 {
		t.Fatal(problems)
	}
}

func TestHostileComments(t *testing.T) {
	model := buildDir(t, filepath.Join(root(t), "fixtures/security"), BuildOptions{Title: "test", InputLabel: "security"})
	msg := findMessage(model, "fixtures.security.Nasty")
	html := ""
	if msg != nil && msg.Comments != nil {
		html = msg.Comments.MarkdownHTML
	}
	if strings.Contains(html, "<script") || strings.Contains(html, "onerror") {
		t.Fatalf("unsafe comment html %s", html)
	}
	field := findField(model, "fixtures.security.Nasty.name")
	if field == nil || field.Comments == nil || !strings.Contains(field.Comments.MarkdownHTML, "<strong>bold</strong>") {
		t.Fatalf("field comment %+v", field)
	}
	if strings.Contains(field.Comments.MarkdownHTML, "javascript:") {
		t.Fatalf("javascript link kept: %s", field.Comments.MarkdownHTML)
	}
}

func TestSourceLinks(t *testing.T) {
	files := filesFrom(t, filepath.Join(root(t), "fixtures/options"))
	model, err := Build(files, BuildOptions{
		Title: "test", InputLabel: "options",
		Source:      &SourceConfig{Repository: "github:acme/apis", Commit: "deadbeef"},
		SourceTexts: map[string]string{"options.proto": "syntax = \"proto3\";\n"},
	})
	if err != nil {
		t.Fatal(err)
	}
	msg := findMessage(model, "fixtures.options.Item")
	if msg == nil || msg.SourceLink == nil || !strings.HasPrefix(msg.SourceLink.URL, "/source/options.proto/#L") {
		t.Fatalf("source link %+v", msg)
	}
	if strings.Contains(msg.SourceLink.URL, "github.com") {
		t.Fatal(msg.SourceLink.URL)
	}
	want := "https://github.com/acme/apis/blob/deadbeef/options.proto#L"
	if msg.RepositoryLink == nil || !strings.HasPrefix(msg.RepositoryLink.URL, want) {
		t.Fatalf("repo link %+v", msg.RepositoryLink)
	}
	bare, err := Build(files, BuildOptions{Title: "test", InputLabel: "options"})
	if err != nil {
		t.Fatal(err)
	}
	file := findFile(bare, "options.proto")
	if file == nil || file.SourceText != "" || file.GeneratePage {
		t.Fatalf("file page %+v", file)
	}
	remote, err := Build(files, BuildOptions{
		Title: "test", InputLabel: "options",
		Source: &SourceConfig{Repository: "gitlab:acme/apis", Commit: "deadbeef"},
	})
	if err != nil {
		t.Fatal(err)
	}
	remoteMsg := findMessage(remote, "fixtures.options.Item")
	if remoteMsg == nil || remoteMsg.SourceLink == nil || !strings.Contains(remoteMsg.SourceLink.URL, "https://gitlab.com/acme/apis/-/blob/deadbeef/options.proto#L") {
		t.Fatalf("view source should use the repository when proto text is absent: %+v", remoteMsg)
	}
	if remoteMsg.RepositoryLink != nil {
		t.Fatalf("repository link duplicated the view-source url: %+v", remoteMsg.RepositoryLink)
	}
}

func TestAcmeIncludeExclude(t *testing.T) {
	dir := filepath.Join(root(t), "examples/acme")
	files := filesFrom(t, dir)
	class := classify.Config{
		Include:        []string{"acme/**"},
		Exclude:        []string{"google/api/**", "buf/validate/**", "cybozu/validate/**"},
		WellKnownTypes: true,
	}
	model, err := Build(files, BuildOptions{
		Title: "Acme", InputLabel: dir, Classification: class,
		SourceTexts: map[string]string{
			"google/api/http.proto":           "syntax = \"proto3\";\n",
			"acme/user/v1/user.proto":         "syntax = \"proto3\";\n",
			"google/protobuf/timestamp.proto": "syntax = \"proto3\";\n",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	http := findMessage(model, "google.api.Http")
	if http == nil || http.GeneratePage {
		t.Fatalf("http page %+v", http != nil)
	}
	rules := findField(model, "google.api.Http.rules")
	if rules == nil || rules.Anchor != "rules" || rules.GeneratePage {
		t.Fatalf("rules %+v", rules)
	}
	if msg := findMessage(model, "buf.validate.StringRules"); msg == nil || msg.GeneratePage {
		t.Fatal("string rules page")
	}
	getUser := findMethod(model, "acme.user.v1.UserService.GetUser")
	if getUser == nil || !getUser.GeneratePage || getUser.InNav || getUser.Anchor != "" {
		t.Fatalf("getUser %+v", getUser)
	}
	if getUser.URLPath != "/reference/methods/acme.user.v1.UserService.GetUser/" {
		t.Fatal(getUser.URLPath)
	}
	email := findField(model, "acme.user.v1.User.email")
	if email == nil || email.URLPath != "/reference/messages/acme.user.v1.User/" {
		t.Fatalf("email %+v", email)
	}
	if !hasSemantic(email.Options, "validation") || email.Options == nil {
		t.Fatal("email validation")
	}
	for _, option := range email.Options {
		if option.Semantic != nil && option.Semantic.RendererID == "validation" && option.DefinitionID != "" {
			t.Fatal("excluded validation definition was linked")
		}
	}
	if !hasSemantic(getUser.Options, "google.api.http") {
		t.Fatalf("http option missing %#v", getUser.Options)
	}
	flag := findField(model, "acme.experiment.v1.Flag.id")
	if flag == nil || !hasSemantic(flag.Options, "cybozu.validate") {
		t.Fatalf("cybozu %+v", flag)
	}
	if user := findMessage(model, "acme.user.v1.User"); user == nil || !user.GeneratePage {
		t.Fatal("user page")
	}
	ts := findMessage(model, "google.protobuf.Timestamp")
	if ts == nil || ts.Domain != "well-known" || !ts.GeneratePage || !ts.InNav {
		t.Fatalf("timestamp %+v", ts)
	}
	created := findField(model, "acme.user.v1.User.created_at")
	if created == nil || created.Type.URLPath != "/reference/messages/google.protobuf.Timestamp/" {
		t.Fatalf("created %+v", created)
	}
	desc := findMessage(model, "google.protobuf.FileDescriptorProto")
	if desc == nil || desc.GeneratePage {
		t.Fatal("descriptor proto should stay hidden")
	}

	hiddenClass := class
	hiddenClass.WellKnownTypes = false
	hidden, err := Build(files, BuildOptions{Title: "Acme", InputLabel: dir, Classification: hiddenClass, SourceTexts: map[string]string{
		"google/protobuf/timestamp.proto": "syntax = \"proto3\";\n",
	}})
	if err != nil {
		t.Fatal(err)
	}
	hiddenTS := findMessage(hidden, "google.protobuf.Timestamp")
	if hiddenTS == nil || hiddenTS.GeneratePage || hiddenTS.InNav {
		t.Fatalf("hidden timestamp %+v", hiddenTS)
	}
	hiddenCreated := findField(hidden, "acme.user.v1.User.created_at")
	if hiddenCreated == nil || hiddenCreated.Type.URLPath != "" {
		t.Fatalf("hidden type link %+v", hiddenCreated)
	}
}

func hasSemantic(options []*DocOption, id string) bool {
	for _, option := range options {
		if option.Semantic != nil && option.Semantic.RendererID == id {
			return true
		}
	}
	return false
}

func referenceProblems(model *SchemaModel) []string {
	var problems []string
	for _, base := range allBases(model) {
		for _, ref := range base.References {
			if ref.FromID != base.ID {
				problems = append(problems, "from mismatch "+base.ID)
			}
			other, ok := basePtr(model.Symbols[ref.ToID])
			if !ok {
				problems = append(problems, "missing "+ref.ToID)
				continue
			}
			found := false
			for _, back := range other.ReferencedBy {
				if back.FromID == ref.FromID && back.ToID == ref.ToID && back.Kind == ref.Kind {
					found = true
				}
			}
			if !found {
				problems = append(problems, "missing backlink "+ref.Kind+" "+ref.FromID)
			}
		}
	}
	return problems
}

func buildDir(t *testing.T, dir string, options BuildOptions) *SchemaModel {
	t.Helper()
	model, err := Build(filesFrom(t, dir), options)
	if err != nil {
		t.Fatal(err)
	}
	return model
}

func filesFrom(t *testing.T, dir string) FileSource {
	t.Helper()
	buf := findBuf(t)
	cmd := exec.Command(buf, "build", "-o", "-", "--as-file-descriptor-set")
	if _, err := os.Stat(filepath.Join(dir, "buf.yaml")); err != nil {
		tmp := t.TempDir()
		if err := os.WriteFile(filepath.Join(tmp, "buf.yaml"), []byte("version: v2\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".proto") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(tmp, entry.Name()), raw, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		dir = tmp
	}
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			t.Fatalf("buf build: %s", ee.Stderr)
		}
		t.Fatal(err)
	}
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(out, &set); err != nil {
		t.Fatal(err)
	}
	files, err := protodesc.NewFiles(&set)
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func findBuf(t *testing.T) string {
	t.Helper()
	candidates := []string{os.Getenv("BUF"), "/tmp/buf", "buf"}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if path, err := exec.LookPath(candidate); err == nil {
			return path
		}
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			return candidate
		}
	}
	if os.Getenv("CI") == "true" || os.Getenv("GITHUB_ACTIONS") == "true" {
		t.Fatal("buf is not available")
	}
	t.Skip("buf is not available")
	return ""
}

func root(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found")
		}
		dir = parent
	}
}

func findMessage(model *SchemaModel, name string) *DocMessage {
	for _, item := range model.Messages {
		if item.FullName == name {
			return item
		}
	}
	return nil
}
func findField(model *SchemaModel, name string) *DocField {
	for _, item := range model.Fields {
		if item.FullName == name {
			return item
		}
	}
	return nil
}
func findEnum(model *SchemaModel, name string) *DocEnum {
	for _, item := range model.Enums {
		if item.FullName == name {
			return item
		}
	}
	return nil
}
func findExt(model *SchemaModel, name string) *DocExtension {
	for _, item := range model.Extensions {
		if item.FullName == name {
			return item
		}
	}
	return nil
}
func findMethod(model *SchemaModel, name string) *DocMethod {
	for _, item := range model.Methods {
		if item.FullName == name {
			return item
		}
	}
	return nil
}
func findFile(model *SchemaModel, name string) *DocFile {
	for _, item := range model.Files {
		if item.FullName == name {
			return item
		}
	}
	return nil
}
