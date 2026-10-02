package markdown

import (
	"strings"
	"testing"
)

func TestStripsScriptAndHandlers(t *testing.T) {
	html := RenderSafe(`Hello <script>alert("xss")</script> **world** <img src=x onerror="alert(1)">`)
	if !strings.Contains(html, "world") {
		t.Fatalf("missing world: %s", html)
	}
	for _, banned := range []string{"<script", "onerror", "alert"} {
		if strings.Contains(html, banned) {
			t.Fatalf("html contains %q: %s", banned, html)
		}
	}
}

func TestMDXStaysLiteral(t *testing.T) {
	html := RenderSafe("Value {2 * 2} stays literal")
	if !strings.Contains(html, "{2 * 2}") {
		t.Fatalf("expression was evaluated: %s", html)
	}
}

func TestAllowsSafeHTML(t *testing.T) {
	html := RenderSafe(`<p>See the <b>User</b> message.</p>`)
	if !strings.Contains(html, "<b>User</b>") {
		t.Fatalf("bold was stripped: %s", html)
	}
}

func TestEscapeHTML(t *testing.T) {
	got := EscapeHTML(`<foo & "bar">`)
	want := "&lt;foo &amp; &quot;bar&quot;&gt;"
	if got != want {
		t.Fatalf("got %s", got)
	}
}

func TestCommentStars(t *testing.T) {
	got := CommentsToMarkdown(" * line one\n * line two")
	if !strings.Contains(got, "line one") || strings.Contains(got, "* line") {
		t.Fatalf("got %q", got)
	}
}

func TestDropsUnsafeSchemes(t *testing.T) {
	html := RenderSafe(`[js](javascript:alert(1)) [data](data:text/html,<script>alert(1)</script>) [ok](https://example.com/docs)`)
	if strings.Contains(html, "javascript:") || strings.Contains(html, "data:") {
		t.Fatalf("unsafe scheme kept: %s", html)
	}
	if !strings.Contains(html, `href="https://example.com/docs"`) {
		t.Fatalf("safe link missing: %s", html)
	}
}

func TestUnwrapsDisallowedWrappers(t *testing.T) {
	html := RenderSafe(`<div>See <b>keep</b></div>`)
	if strings.Contains(html, "<div") {
		t.Fatalf("wrapper kept: %s", html)
	}
	if !strings.Contains(html, "<b>keep</b>") {
		t.Fatalf("inner markup dropped: %s", html)
	}
}

func TestDiscardsTags(t *testing.T) {
	html := RenderSafe(`<iframe src="https://evil.example"></iframe><svg><script>alert(1)</script></svg><style>body{}</style><img src=x>`)
	for _, banned := range []string{"<iframe", "<svg", "<style", "<img", "<script", "alert"} {
		if strings.Contains(html, banned) {
			t.Fatalf("html contains %q: %s", banned, html)
		}
	}
}

func TestLinkRel(t *testing.T) {
	html := RenderSafe(`<a href="https://example.com" onclick="alert(1)" target="_blank">docs</a>`)
	if strings.Contains(html, "onclick") || strings.Contains(html, "alert") {
		t.Fatalf("handler kept: %s", html)
	}
	if !strings.Contains(html, `rel="noopener noreferrer"`) || !strings.Contains(html, ">docs</a>") {
		t.Fatalf("link shape: %s", html)
	}
}
