package main

import (
	"strings"
	"testing"
)

func TestBuildHelp(t *testing.T) {
	if err := run([]string{"build", "--help"}); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsExtraPositionals(t *testing.T) {
	err := run([]string{"build", "a.binpb", "b.binpb"})
	if err == nil || !strings.Contains(err.Error(), "at most one") {
		t.Fatalf("got %v", err)
	}
}

func TestDoctorRejectsIrrelevantFlag(t *testing.T) {
	err := run([]string{"doctor", "--port", "1"})
	if err == nil || !strings.Contains(err.Error(), "port") {
		t.Fatalf("got %v", err)
	}
}

func TestInitRejectsPositional(t *testing.T) {
	err := run([]string{"init", "schema.binpb"})
	if err == nil || !strings.Contains(err.Error(), "positional") {
		t.Fatalf("got %v", err)
	}
}

func TestDiffRequiresAgainst(t *testing.T) {
	err := run([]string{"diff", "a.binpb"})
	if err == nil || !strings.Contains(err.Error(), "--against") {
		t.Fatalf("got %v", err)
	}
}

func TestShortConfigFlag(t *testing.T) {
	f, err := parseBuild("build", []string{"-c", "cfg.yaml", "--against", "old.binpb", "schema.binpb"})
	if err != nil {
		t.Fatal(err)
	}
	if f.config != "cfg.yaml" || f.against != "old.binpb" || len(f.rest) != 1 || f.rest[0] != "schema.binpb" {
		t.Fatalf("%+v", f)
	}
}

func TestDevRejectsAgainst(t *testing.T) {
	err := run([]string{"dev", "--against", "old.binpb", "schema.binpb"})
	if err == nil || !strings.Contains(err.Error(), "against") {
		t.Fatalf("got %v", err)
	}
}
