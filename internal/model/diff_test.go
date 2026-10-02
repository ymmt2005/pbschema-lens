package model

import "testing"

func TestDiffAddedAndRemoved(t *testing.T) {
	prev := &SchemaModel{Symbols: map[string]any{
		"message:A": &DocMessage{baseSymbol: newBase("message", "A", "A", "p", "a.proto", "local", true, true, false)},
	}}
	next := &SchemaModel{Symbols: map[string]any{
		"message:B": &DocMessage{baseSymbol: newBase("message", "B", "B", "p", "b.proto", "local", true, true, false)},
	}}
	diff := Diff(next, prev, "old")
	if len(diff.Added) != 1 || diff.Added[0].ID != "message:B" {
		t.Fatalf("added %+v", diff.Added)
	}
	if len(diff.Removed) != 1 || diff.Removed[0].ID != "message:A" {
		t.Fatalf("removed %+v", diff.Removed)
	}
}
