package model

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

func symbolID(kind, fullName string) string {
	return kind + ":" + fullName
}

func slug(name string) string {
	name = camelBoundary.ReplaceAllString(name, "${1}-${2}")
	name = strings.NewReplacer("_", "-", " ", "-").Replace(name)
	name = nonSlug.ReplaceAllString(name, "")
	return strings.ToLower(name)
}

var (
	camelBoundary = regexp.MustCompile(`([a-z0-9])([A-Z])`)
	nonSlug       = regexp.MustCompile(`[^a-zA-Z0-9-]`)
)

func urlPathFor(kind, fullName, parent string) (path, anchor string) {
	switch kind {
	case "package":
		return "/reference/packages/" + url.PathEscape(fullName) + "/", ""
	case "message":
		return "/reference/messages/" + url.PathEscape(fullName) + "/", ""
	case "enum":
		return "/reference/enums/" + url.PathEscape(fullName) + "/", ""
	case "service":
		return "/reference/services/" + url.PathEscape(fullName) + "/", ""
	case "extension":
		return "/reference/extensions/" + url.PathEscape(fullName) + "/", ""
	case "file":
		parts := strings.Split(fullName, "/")
		for i, part := range parts {
			parts[i] = url.PathEscape(part)
		}
		return "/source/" + strings.Join(parts, "/") + "/", ""
	case "field":
		return "/reference/messages/" + url.PathEscape(parent) + "/", slug(shortName(fullName))
	case "oneof":
		return "/reference/messages/" + url.PathEscape(parent) + "/", "oneof-" + slug(shortName(fullName))
	case "method":
		return "/reference/methods/" + url.PathEscape(fullName) + "/", ""
	case "enum-value":
		return "/reference/enums/" + url.PathEscape(parent) + "/", slug(shortName(fullName))
	default:
		return "/", ""
	}
}

func shortName(fullName string) string {
	if i := strings.LastIndex(fullName, "."); i >= 0 {
		return fullName[i+1:]
	}
	if i := strings.LastIndex(fullName, "/"); i >= 0 {
		return fullName[i+1:]
	}
	return fullName
}

func fileSourcePath(fileName string, line int) string {
	path, _ := urlPathFor("file", fileName, "")
	if line > 0 {
		return path + "#L" + strconv.Itoa(line)
	}
	return path
}

// SourceConfig builds the separate repository link.
type SourceConfig struct {
	Repository  string
	Commit      string
	URLTemplate string
}

func repositoryBlobURL(config *SourceConfig, fileName string, line int) string {
	if config == nil {
		return ""
	}
	commit := config.Commit
	if commit == "" {
		commit = "HEAD"
	}
	if config.URLTemplate != "" {
		return strings.NewReplacer(
			"{file}", fileName,
			"{line}", strconv.Itoa(line),
			"{commit}", commit,
		).Replace(config.URLTemplate)
	}
	repo := config.Repository
	if m := githubRepo.FindStringSubmatch(repo); m != nil {
		return "https://github.com/" + m[1] + "/blob/" + commit + "/" + fileName + "#L" + strconv.Itoa(line)
	}
	if m := githubURL.FindStringSubmatch(repo); m != nil {
		return "https://github.com/" + m[1] + "/blob/" + commit + "/" + fileName + "#L" + strconv.Itoa(line)
	}
	if m := gitlabRepo.FindStringSubmatch(repo); m != nil {
		return "https://gitlab.com/" + strings.TrimSuffix(m[1], "/") + "/-/blob/" + commit + "/" + fileName + "#L" + strconv.Itoa(line)
	}
	if m := gitlabURL.FindStringSubmatch(repo); m != nil {
		return "https://gitlab.com/" + strings.TrimSuffix(m[1], "/") + "/-/blob/" + commit + "/" + fileName + "#L" + strconv.Itoa(line)
	}
	return ""
}

var (
	githubRepo = regexp.MustCompile(`^github:([^/]+/[^/]+)$`)
	githubURL  = regexp.MustCompile(`^https?://github\.com/([^/]+/[^/]+?)(?:\.git)?/?$`)
	gitlabRepo = regexp.MustCompile(`^gitlab:([^/]+/.+)$`)
	gitlabURL  = regexp.MustCompile(`^https?://gitlab\.com/(.+?)(?:\.git)?/?$`)
)

func sourceRefs(fileName string, line int, config *SourceConfig, hasLocal bool) (source, repo *SourceLink) {
	if line < 1 {
		line = 1
	}
	label := fileName + ":" + strconv.Itoa(line)
	blob := repositoryBlobURL(config, fileName, line)
	if hasLocal {
		source = &SourceLink{Label: label, URL: fileSourcePath(fileName, line)}
		if blob != "" {
			repo = &SourceLink{Label: label, URL: blob}
		}
		return source, repo
	}
	// No in-site proto text: View source is the repository URL.
	if blob != "" {
		source = &SourceLink{Label: label, URL: blob}
	}
	return source, nil
}
