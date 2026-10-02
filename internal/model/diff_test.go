package model

import (
	"math"
	"testing"
)

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

func TestItoaFormatsMinInt32(t *testing.T) {
	if got := itoa(math.MinInt32); got != "-2147483648" {
		t.Fatalf("min int32 formatted as %s", got)
	}
}
