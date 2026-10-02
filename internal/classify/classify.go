// Package classify decides which descriptor files get pages and navigation.
package classify

import (
	"net/url"
	"regexp"
	"strings"
)

// Domain is where a file sits relative to this documentation build.
type Domain string

const (
	DomainLocal       Domain = "local"
	DomainWellKnown   Domain = "well-known"
	DomainExternalDoc Domain = "external-documented"
	DomainExternal    Domain = "external-undocumented"
)

// Config is the documentation include, exclude, and external-link rules.
type Config struct {
	Include        []string
	Exclude        []string
	ExternalLinks  []ExternalLink
	WellKnownTypes bool
}

// ExternalLink sends a package to another site.
type ExternalLink struct {
	Package     string
	URLTemplate string
}

// Result is the classification of one file.
type Result struct {
	Domain       Domain
	GeneratePage bool
	InNav        bool
	ExternalURL  string
}

var wktFiles = map[string]struct{}{
	"google/protobuf/any.proto": {}, "google/protobuf/api.proto": {},
	"google/protobuf/descriptor.proto": {}, "google/protobuf/duration.proto": {},
	"google/protobuf/empty.proto": {}, "google/protobuf/field_mask.proto": {},
	"google/protobuf/source_context.proto": {}, "google/protobuf/struct.proto": {},
	"google/protobuf/timestamp.proto": {}, "google/protobuf/type.proto": {},
	"google/protobuf/wrappers.proto": {}, "google/protobuf/compiler/plugin.proto": {},
	"google/protobuf/cpp_features.proto": {}, "google/protobuf/java_features.proto": {},
	"google/protobuf/go_features.proto": {},
}

var hiddenWKT = map[string]struct{}{
	"google/protobuf/descriptor.proto": {}, "google/protobuf/compiler/plugin.proto": {},
	"google/protobuf/api.proto": {}, "google/protobuf/type.proto": {},
	"google/protobuf/source_context.proto": {}, "google/protobuf/cpp_features.proto": {},
	"google/protobuf/java_features.proto": {}, "google/protobuf/go_features.proto": {},
}

var wktPackages = map[string]struct{}{
	"google.protobuf": {}, "google.protobuf.compiler": {},
}

// File classifies one proto file.
func File(fileName, packageName string, config Config) Result {
	if _, ok := wktFiles[fileName]; ok {
		return wktResult(fileName, config)
	}
	if _, ok := wktPackages[packageName]; ok {
		return wktResult(fileName, config)
	}
	if external := matchExternal(packageName, config.ExternalLinks); external != "" {
		return Result{Domain: DomainExternalDoc, ExternalURL: external}
	}
	if Excluded(fileName, packageName, config.Exclude) {
		return Result{Domain: DomainExternal}
	}
	if len(config.Include) > 0 {
		if matchesAny(fileName, packageName, config.Include) {
			return Result{Domain: DomainLocal, GeneratePage: true, InNav: true}
		}
		return Result{Domain: DomainExternal}
	}
	return Result{Domain: DomainLocal, GeneratePage: true, InNav: true}
}

func wktResult(fileName string, config Config) Result {
	_, hiddenFile := hiddenWKT[fileName]
	hidden := !config.WellKnownTypes || hiddenFile
	return Result{Domain: DomainWellKnown, GeneratePage: !hidden, InNav: !hidden}
}

// Excluded reports whether a file or package matches an exclude pattern.
func Excluded(fileName, packageName string, patterns []string) bool {
	return matchesAny(fileName, packageName, patterns)
}

// ExternalURL resolves a symbol to an external documentation URL.
func ExternalURL(fullName, kind string, config Config) string {
	pkg := packageOf(fullName)
	for _, rule := range config.ExternalLinks {
		if matchPackage(fullName, rule.Package) || matchPackage(pkg, rule.Package) {
			return strings.NewReplacer(
				"{symbol}", url.QueryEscape(fullName),
				"{kind}", kind,
				"{package}", url.QueryEscape(pkg),
			).Replace(rule.URLTemplate)
		}
	}
	return ""
}

func matchExternal(packageName string, rules []ExternalLink) string {
	for _, rule := range rules {
		if matchPackage(packageName, rule.Package) {
			return strings.ReplaceAll(rule.URLTemplate, "{package}", url.QueryEscape(packageName))
		}
	}
	return ""
}

func matchesAny(fileName, packageName string, patterns []string) bool {
	for _, pattern := range patterns {
		if matchGlob(fileName, pattern) || matchPackage(packageName, pattern) {
			return true
		}
	}
	return false
}

func matchPackage(name, pattern string) bool {
	if name == strings.TrimSuffix(pattern, ".**") {
		return true
	}
	return matchGlob(name, pattern)
}

func matchGlob(path, pattern string) bool {
	re, err := regexp.Compile(globToRegexp(pattern))
	if err != nil {
		return false
	}
	return re.MatchString(path)
}

func globToRegexp(pattern string) string {
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		if pattern[i] == '*' && i+1 < len(pattern) && pattern[i+1] == '*' {
			b.WriteString(".*")
			i++
			continue
		}
		if pattern[i] == '*' {
			b.WriteString("[^/]*")
			continue
		}
		if strings.ContainsRune(`.+?()|[]{}^$`, rune(pattern[i])) {
			b.WriteByte('\\')
		}
		b.WriteByte(pattern[i])
	}
	b.WriteString("$")
	return b.String()
}

func packageOf(fullName string) string {
	if i := strings.LastIndex(fullName, "."); i >= 0 {
		return fullName[:i]
	}
	return ""
}
