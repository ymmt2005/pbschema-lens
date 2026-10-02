package pipeline

import "testing"

func TestSourceMatches(t *testing.T) {
	cases := []struct {
		rel, name string
		want      bool
	}{
		{"acme/user/v1/user.proto", "acme/user/v1/user.proto", true},
		{"user.proto", "acme/user/v1/user.proto", true},
		{"examples/acme/proto/acme/user/v1/user.proto", "acme/user/v1/user.proto", true},
		{"notuser.proto", "user.proto", false},
		{"extra.proto", "a.proto", false},
		{"vendor/acme/user.proto", "acme/user.proto", true},
	}
	for _, tc := range cases {
		if got := sourceMatches(tc.rel, tc.name); got != tc.want {
			t.Fatalf("sourceMatches(%q, %q) = %v, want %v", tc.rel, tc.name, got, tc.want)
		}
	}
}
