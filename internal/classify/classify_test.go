package classify

import "testing"

func TestClassify(t *testing.T) {
	config := Config{
		Include: []string{"acme/user/**"},
		Exclude: []string{"google/api/**", "buf/validate/**", "cybozu/validate/**"},
		ExternalLinks: []ExternalLink{{
			Package:     "acme.billing.v1.**",
			URLTemplate: "https://docs.example.com/billing/{symbol}",
		}},
		WellKnownTypes: false,
	}
	assert := func(file, pkg string, want Result) {
		t.Helper()
		got := File(file, pkg, config)
		if got != want {
			t.Fatalf("%s %s: got %+v want %+v", file, pkg, got, want)
		}
	}
	assert("acme/user/v1/user.proto", "acme.user.v1", Result{Domain: DomainLocal, GeneratePage: true, InNav: true})
	assert("acme/experiment/v1/flags.proto", "acme.experiment.v1", Result{Domain: DomainExternal})
	assert("google/api/http.proto", "google.api", Result{Domain: DomainExternal})
	assert("acme/billing/v1/invoice.proto", "acme.billing.v1", Result{
		Domain: DomainExternalDoc, ExternalURL: "https://docs.example.com/billing/{symbol}",
	})
	if got := ExternalURL("acme.billing.v1.Invoice", "message", config); got != "https://docs.example.com/billing/acme.billing.v1.Invoice" {
		t.Fatalf("external url %s", got)
	}
	assert("google/protobuf/timestamp.proto", "google.protobuf", Result{Domain: DomainWellKnown})

	shown := config
	shown.WellKnownTypes = true
	ts := File("google/protobuf/timestamp.proto", "google.protobuf", shown)
	if !ts.GeneratePage || !ts.InNav {
		t.Fatalf("timestamp should publish: %+v", ts)
	}
	desc := File("google/protobuf/descriptor.proto", "google.protobuf", shown)
	if desc.GeneratePage || desc.InNav || desc.Domain != DomainWellKnown {
		t.Fatalf("descriptor should stay hidden: %+v", desc)
	}
}
