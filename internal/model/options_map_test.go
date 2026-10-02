package model

import (
	"strings"
	"testing"
)

func TestMapKeyTextUsesDescriptorKind(t *testing.T) {
	text := writeMessageBody([]OptionField{{
		Name: "labels",
		Value: OptionValue{Kind: "map", Entries: []OptionMapEntry{
			{Key: "123", KeyKind: "string", Value: OptionValue{Kind: "scalar", Scalar: "string", Value: "a"}},
			{Key: "123", KeyKind: "int32", Value: OptionValue{Kind: "scalar", Scalar: "string", Value: "b"}},
			{Key: "true", KeyKind: "bool", Value: OptionValue{Kind: "scalar", Scalar: "string", Value: "c"}},
			{Key: "true", KeyKind: "string", Value: OptionValue{Kind: "scalar", Scalar: "string", Value: "d"}},
		}},
	}})
	for _, want := range []string{`key: "123"`, "key: 123", "key: true", `key: "true"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %s in\n%s", want, text)
		}
	}
	if strings.Count(text, "key: 123\n") != 1 {
		t.Fatalf("integer key was quoted or duplicated:\n%s", text)
	}
}
