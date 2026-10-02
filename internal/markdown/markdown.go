// Package markdown turns untrusted proto comments into an allowlisted HTML subset.
package markdown

import (
	"bytes"
	"io"
	"net/url"
	"strings"

	"regexp"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	gmhtml "github.com/yuin/goldmark/renderer/html"
	"golang.org/x/net/html"
)

// dropContents tags are removed together with their children. Other disallowed
// tags are unwrapped so a wrapper such as <div> does not delete the text inside.
var dropContents = map[string]struct{}{
	"script": {}, "style": {}, "iframe": {}, "noembed": {}, "noframes": {},
	"noscript": {}, "textarea": {}, "title": {}, "svg": {}, "math": {},
}

var allowedTags = map[string]struct{}{
	"p": {}, "br": {}, "b": {}, "i": {}, "em": {}, "strong": {}, "code": {}, "pre": {},
	"a": {}, "ul": {}, "ol": {}, "li": {}, "blockquote": {},
	"h1": {}, "h2": {}, "h3": {}, "h4": {}, "h5": {}, "h6": {},
	"table": {}, "thead": {}, "tbody": {}, "tr": {}, "th": {}, "td": {}, "hr": {}, "span": {},
}

var md = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(
		gmhtml.WithUnsafe(),
		gmhtml.WithHardWraps(),
	),
)

var starLine = regexp.MustCompile(`(?m)^\s*\*\s?`)

// CommentsToMarkdown joins proto comment fragments after stripping comment markers.
func CommentsToMarkdown(parts ...string) string {
	var kept []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		part = strings.TrimPrefix(part, "/**")
		part = strings.TrimPrefix(part, "/*")
		part = strings.TrimSuffix(part, "*/")
		part = starLine.ReplaceAllString(part, "")
		kept = append(kept, strings.TrimSpace(part))
	}
	return strings.Join(kept, "\n\n")
}

// RenderSafe renders Markdown and discards every tag and attribute outside the allowlist.
func RenderSafe(markdown string) string {
	if strings.TrimSpace(markdown) == "" {
		return ""
	}
	var buf bytes.Buffer
	if err := md.Convert([]byte(markdown), &buf); err != nil {
		return EscapeHTML(markdown)
	}
	return sanitize(buf.String())
}

// EscapeHTML escapes text that will be inserted into HTML.
func EscapeHTML(text string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	)
	return replacer.Replace(text)
}

func sanitize(fragment string) string {
	doc, err := html.Parse(strings.NewReader("<html><body>" + fragment + "</body></html>"))
	if err != nil {
		return ""
	}
	body := findBody(doc)
	if body == nil {
		return ""
	}
	var buf bytes.Buffer
	for child := body.FirstChild; child != nil; child = child.NextSibling {
		writeAllowed(&buf, child)
	}
	return buf.String()
}

func findBody(node *html.Node) *html.Node {
	if node.Type == html.ElementNode && node.Data == "body" {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := findBody(child); found != nil {
			return found
		}
	}
	return nil
}

func writeAllowed(w io.Writer, node *html.Node) {
	switch node.Type {
	case html.TextNode:
		io.WriteString(w, EscapeHTML(node.Data))
	case html.ElementNode:
		if _, ok := allowedTags[node.Data]; !ok {
			if _, drop := dropContents[node.Data]; drop {
				return
			}
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				writeAllowed(w, child)
			}
			return
		}
		io.WriteString(w, "<")
		io.WriteString(w, node.Data)
		writeAttrs(w, node)
		if void(node.Data) {
			io.WriteString(w, ">")
			return
		}
		io.WriteString(w, ">")
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			writeAllowed(w, child)
		}
		io.WriteString(w, "</")
		io.WriteString(w, node.Data)
		io.WriteString(w, ">")
	default:
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			writeAllowed(w, child)
		}
	}
}

func void(tag string) bool {
	return tag == "br" || tag == "hr"
}

func writeAttrs(w io.Writer, node *html.Node) {
	switch node.Data {
	case "a":
		href, title := "", ""
		for _, attr := range node.Attr {
			switch attr.Key {
			case "href":
				href = attr.Val
			case "title":
				title = attr.Val
			}
		}
		if safeURL(href) {
			io.WriteString(w, ` href="`)
			io.WriteString(w, EscapeHTML(href))
			io.WriteString(w, `"`)
			io.WriteString(w, ` rel="noopener noreferrer"`)
		}
		if title != "" {
			io.WriteString(w, ` title="`)
			io.WriteString(w, EscapeHTML(title))
			io.WriteString(w, `"`)
		}
	case "code", "span":
		writeClass(w, node)
	case "th", "td":
		for _, attr := range node.Attr {
			if attr.Key == "align" && (attr.Val == "left" || attr.Val == "center" || attr.Val == "right") {
				io.WriteString(w, ` align="`)
				io.WriteString(w, attr.Val)
				io.WriteString(w, `"`)
			}
		}
	}
}

func writeClass(w io.Writer, node *html.Node) {
	for _, attr := range node.Attr {
		if attr.Key == "class" && !strings.ContainsAny(attr.Val, "\"<>") {
			io.WriteString(w, ` class="`)
			io.WriteString(w, EscapeHTML(attr.Val))
			io.WriteString(w, `"`)
		}
	}
}

func safeURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\"<> \t\r\n\\") {
		return false
	}
	if strings.HasPrefix(raw, "//") {
		return false
	}
	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(lower, "data:") {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if parsed.Scheme == "" {
		return true
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto":
		return true
	default:
		return false
	}
}
