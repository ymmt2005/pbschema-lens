package main

import "testing"

func TestParseBuildArgsAcceptsFlagsAfterInput(t *testing.T) {
	input, out, base, title, err := parseBuildArgs([]string{
		"examples/acme", "--out", "/tmp/pbschema-poc", "--title", "Acme Protobuf API", "--base", "/pbschema-lens",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input != "examples/acme" || out != "/tmp/pbschema-poc" || base != "/pbschema-lens" || title != "Acme Protobuf API" {
		t.Fatalf("got %q %q %q %q", input, out, base, title)
	}
}

func TestParseBuildArgsAcceptsFlagsBeforeInput(t *testing.T) {
	input, out, _, title, err := parseBuildArgs([]string{"--out=/tmp/out", "--title=Widgets", "schema.binpb"})
	if err != nil {
		t.Fatal(err)
	}
	if input != "schema.binpb" || out != "/tmp/out" || title != "Widgets" {
		t.Fatalf("got %q %q %q", input, out, title)
	}
}

func TestParseBuildArgsDefaultsToStdin(t *testing.T) {
	input, out, _, _, err := parseBuildArgs([]string{"--out", "dist"})
	if err != nil {
		t.Fatal(err)
	}
	if input != "-" || out != "dist" {
		t.Fatalf("got %q %q", input, out)
	}
}

func TestParseBuildArgsAcceptsStdinMarker(t *testing.T) {
	input, _, _, _, err := parseBuildArgs([]string{"-", "--out", "dist"})
	if err != nil {
		t.Fatal(err)
	}
	if input != "-" {
		t.Fatalf("got %q", input)
	}
}

func TestParseBuildArgsRejectsTwoInputs(t *testing.T) {
	if _, _, _, _, err := parseBuildArgs([]string{"a", "b"}); err == nil {
		t.Fatal("expected two inputs to fail")
	}
}
