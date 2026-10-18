package model

import (
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestFileHeaderCommentLocations(t *testing.T) {
	for _, tc := range []struct {
		name  string
		paths [][]int32
	}{
		{"root", [][]int32{{}}},
		{"syntax", [][]int32{{12}}},
		{"edition", [][]int32{{14}}},
		{"root and keyword", [][]int32{{}, {12}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fd := &descriptorpb.FileDescriptorProto{Name: proto.String("demo.proto"), Syntax: proto.String("proto3"), SourceCodeInfo: &descriptorpb.SourceCodeInfo{}}
			for i, path := range tc.paths {
				text := "Header."
				if i > 0 {
					text = "Keyword."
				}
				fd.SourceCodeInfo.Location = append(fd.SourceCodeInfo.Location, &descriptorpb.SourceCodeInfo_Location{Path: path, Span: []int32{0, 0, 1}, LeadingComments: proto.String(text)})
			}
			desc, err := protodesc.NewFile(fd, nil)
			if err != nil {
				t.Fatal(err)
			}
			got := fileComment(desc)
			if got == nil || !strings.Contains(got.MarkdownHTML, "Header.") {
				t.Fatalf("missing header: %+v", got)
			}
			if len(tc.paths) > 1 && !strings.Contains(got.MarkdownHTML, "Keyword.") {
				t.Fatalf("keyword comment lost: %+v", got)
			}
		})
	}
}

func TestCommentContextKeepsSourceOrder(t *testing.T) {
	context := &DocComment{Detached: []string{"Context detached."}, Leading: "Context leading.", Trailing: "Context trailing."}
	own := &DocComment{Detached: []string{"Own detached."}, Leading: "Own leading.", Trailing: "Own trailing."}
	combined := withCommentContext(context, own)
	previous := -1
	for _, text := range []string{"Context detached.", "Context leading.", "Own detached.", "Own leading.", "Own trailing.", "Context trailing."} {
		index := strings.Index(combined.MarkdownHTML, text)
		if index <= previous {
			t.Fatalf("comment order lost at %q: %s", text, combined.MarkdownHTML)
		}
		previous = index
	}
	if own.Trailing != "Own trailing." || len(own.Detached) != 1 || len(context.Detached) != 1 {
		t.Fatal("combining comment context mutated the original comments")
	}
}

// Compile real source: synthetic descriptor paths alone cannot establish where
// the compiler puts comments for files, groups, or repeated extend blocks.
func TestCommentsAcrossProtobufObjects(t *testing.T) {
	schema := buildDir(t, filepath.Join(root(t), "fixtures/comments"), BuildOptions{})
	for _, tc := range []struct {
		id      string
		markers []string
	}{
		{"file:objects.proto", []string{"FILE_DETACHED", "FILE_LEADING", "FILE_TRAILING"}},
		{"file:modern.proto", []string{"MODERN_FILE_LEADING"}},
		{"file:editions.proto", []string{"EDITIONS_FILE_LEADING"}},
		{"package:fixtures.comments", []string{"PACKAGE_LEADING"}},
		{"message:fixtures.comments.Envelope", []string{"MESSAGE_DETACHED_ONE", "MESSAGE_DETACHED_TWO", "MESSAGE_LEADING"}},
		{"field:fixtures.comments.Envelope.name", []string{"FIELD_LEADING", "FIELD_TRAILING"}},
		{"field:fixtures.comments.Envelope.labels", []string{"MAP_LEADING"}},
		{"oneof:fixtures.comments.Envelope.choice", []string{"ONEOF_LEADING"}},
		{"field:fixtures.comments.Envelope.email", []string{"ONEOF_FIELD_LEADING", "ONEOF_FIELD_TRAILING"}},
		{"message:fixtures.comments.Envelope.Child", []string{"NESTED_MESSAGE_LEADING"}},
		{"field:fixtures.comments.Envelope.Child.value", []string{"NESTED_FIELD_LEADING"}},
		{"enum:fixtures.comments.Envelope.State", []string{"NESTED_ENUM_LEADING"}},
		{"enum-value:fixtures.comments.Envelope.State.STATE_UNKNOWN", []string{"NESTED_VALUE_LEADING", "NESTED_VALUE_TRAILING"}},
		{"message:fixtures.comments.Envelope.LegacyGroup", []string{"GROUP_LEADING"}},
		{"field:fixtures.comments.Envelope.legacygroup", []string{"GROUP_LEADING"}},
		{"field:fixtures.comments.Envelope.LegacyGroup.value", []string{"GROUP_FIELD_LEADING"}},
		{"enum:fixtures.comments.Status", []string{"ENUM_LEADING"}},
		{"enum-value:fixtures.comments.Status.STATUS_UNKNOWN", []string{"VALUE_LEADING", "VALUE_TRAILING"}},
		{"extension:fixtures.comments.extra", []string{"EXTEND_BLOCK_LEADING", "EXTENSION_LEADING", "EXTENSION_TRAILING"}},
		{"extension:fixtures.comments.other", []string{"SECOND_EXTEND_BLOCK_LEADING", "SECOND_EXTENSION_LEADING"}},
		{"extension:fixtures.comments.Holder.enabled", []string{"NESTED_EXTEND_BLOCK_LEADING", "NESTED_EXTENSION_LEADING", "NESTED_EXTENSION_TRAILING"}},
		{"extension:fixtures.comments.extragroup", []string{"GROUP_EXTEND_BLOCK_LEADING", "GROUP_EXTENSION_LEADING"}},
		{"field:fixtures.comments.ExtraGroup.value", []string{"GROUP_EXTENSION_FIELD_LEADING"}},
		{"service:fixtures.comments.Catalog", []string{"SERVICE_LEADING"}},
		{"method:fixtures.comments.Catalog.Get", []string{"METHOD_LEADING", "METHOD_TRAILING"}},
		{"method:fixtures.comments.Catalog.Watch", []string{"STREAM_METHOD_LEADING"}},
		{"field:fixtures.comments.modern.Modern.nickname", []string{"OPTIONAL_FIELD_LEADING", "OPTIONAL_FIELD_TRAILING"}},
		{"field:fixtures.comments.editions.Modern.nickname", []string{"EDITIONS_FIELD_LEADING", "EDITIONS_FIELD_TRAILING"}},
		{"message:fixtures.comments.modern.Block", []string{"BLOCK_COMMENT_LEADING"}},
		{"message:fixtures.comments.modern.DecoratedBlock", []string{"DECORATED_BLOCK_LEADING", "DECORATED_LIST_ONE", "DECORATED_LIST_TWO"}},
	} {
		t.Run(tc.id, func(t *testing.T) {
			metadata := SymbolMetadata(schema.Symbols[tc.id])
			if metadata == nil || metadata.Comments == nil {
				t.Fatalf("missing comment for %s", tc.id)
			}
			html := metadata.Comments.MarkdownHTML
			previous := -1
			for _, marker := range tc.markers {
				index := strings.Index(html, marker)
				if index <= previous {
					t.Errorf("missing or misplaced %s in %s", marker, html)
				}
				previous = index
			}
			if !strings.Contains(html, "<strong>") {
				t.Errorf("Markdown formatting missing: %s", html)
			}
		})
	}
	for _, tc := range []struct {
		id       string
		unwanted string
	}{
		{"extension:fixtures.comments.extra", "SECOND_EXTEND_BLOCK"},
		{"extension:fixtures.comments.other", "EXTENSION_TRAILING"},
		{"extension:fixtures.comments.Holder.enabled", "SECOND_EXTEND_BLOCK"},
	} {
		if comments := SymbolMetadata(schema.Symbols[tc.id]).Comments; comments != nil && strings.Contains(comments.MarkdownHTML, tc.unwanted) {
			t.Errorf("%s contains comments from another extend block: %s", tc.id, comments.MarkdownHTML)
		}
	}
	for _, id := range []string{"message:fixtures.comments.modern.Markdown", "message:fixtures.comments.modern.DecoratedBlock"} {
		if html := SymbolMetadata(schema.Symbols[id]).Comments.MarkdownHTML; !strings.Contains(html, "<ul>") || !strings.Contains(html, "<li>") {
			t.Errorf("asterisk list lost in %s: %s", id, html)
		}
	}
	if html := SymbolMetadata(schema.Symbols["message:fixtures.comments.modern.Markdown"]).Comments.MarkdownHTML; !strings.Contains(html, "*ptr = 1;\n  **nested = 2;") {
		t.Errorf("code asterisks or indentation lost: %s", html)
	}
	if len(schema.Oneofs) != 1 {
		t.Errorf("synthetic optional oneof leaked into documented objects: %+v", schema.Oneofs)
	}
}
