package markdown

import (
	"fmt"
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

func TestCommentNewlines(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"soft break", "support\nworkflows", "<p>support\nworkflows</p>"},
		{"paragraph", "support\n\nworkflows", "<p>support</p>\n<p>workflows</p>"},
		{"two-space hard break", "support  \nworkflows", "<p>support<br>workflows</p>"},
		{"backslash hard break", "support\\\nworkflows", "<p>support<br>workflows</p>"},
		{"fenced code", "```proto\nmessage User {\n  string name = 1;\n}\n```", "<pre><code class=\"language-proto\">message User {\n  string name = 1;\n}\n</code></pre>"},
		{"indented code", "Example:\n\n    first\n      second\n", "<p>Example:</p>\n<pre><code>first\n  second\n</code></pre>"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := strings.TrimSpace(RenderSafe(tc.source)); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestCommentHeadingLevels(t *testing.T) {
	for level := 1; level <= 6; level++ {
		wantLevel := min(level+1, 6)
		for _, source := range []string{
			strings.Repeat("#", level) + " Section",
			fmt.Sprintf(`<h%d onclick="alert(1)">Section</h%d>`, level, level),
		} {
			want := fmt.Sprintf("<h%d>Section</h%d>", wantLevel, wantLevel)
			if got := strings.TrimSpace(RenderSafe(source)); got != want {
				t.Errorf("source %q: got %q, want %q", source, got, want)
			}
		}
	}
	for _, source := range []string{"Section\n=======", "<H1>Section</H1>"} {
		if got := strings.TrimSpace(RenderSafe(source)); got != "<h2>Section</h2>" {
			t.Errorf("source %q: got %q", source, got)
		}
	}
}

func TestHeadingTextInCodeStaysLiteral(t *testing.T) {
	for _, source := range []string{"`<h1>Title</h1>`", "```html\n<h1>Title</h1>\n```"} {
		got := RenderSafe(source)
		if !strings.Contains(got, "&lt;h1&gt;Title&lt;/h1&gt;") || strings.Contains(got, "<h2>") {
			t.Fatalf("code changed: %s", got)
		}
	}
	got := RenderSafe(`<a href="https://example.com" title="<h1>Title</h1>">link</a>`)
	if !strings.Contains(got, `title="&lt;h1&gt;Title&lt;/h1&gt;"`) {
		t.Fatalf("heading-like attribute changed: %s", got)
	}
}

func TestCommentHeadingsAfterForeignContentRepair(t *testing.T) {
	for _, foreign := range []string{"svg", "math"} {
		for _, raw := range []string{"style", "script", "textarea"} {
			for level := 1; level <= 6; level++ {
				source := fmt.Sprintf(`<%s><%s><h%d onclick="alert(1)">Title</h%d></%s></%s>`, foreign, raw, level, level, raw, foreign)
				t.Run(fmt.Sprintf("%s/%s/h%d", foreign, raw, level), func(t *testing.T) {
					got := RenderSafe(source)
					want := fmt.Sprintf("<h%d>Title</h%d>", min(level+1, 6), min(level+1, 6))
					if !strings.Contains(got, want) {
						t.Fatalf("repaired heading not normalized: got %q, want %q", got, want)
					}
					for _, banned := range []string{"<h1", "<svg", "<math", "<style", "<script", "<textarea", "onclick", "alert"} {
						if strings.Contains(got, banned) {
							t.Errorf("unexpected %q in %q", banned, got)
						}
					}
				})
			}
		}
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

func TestAllowsRelativeAndFragmentLinks(t *testing.T) {
	html := RenderSafe(`[a](./docs/page.html) [b](../up.md) [c](/abs) [d](#section) [e](docs/page.html)`)
	for _, want := range []string{`href="./docs/page.html"`, `href="../up.md"`, `href="/abs"`, `href="#section"`, `href="docs/page.html"`} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
}

func TestRejectsProtocolRelative(t *testing.T) {
	html := RenderSafe(`[x](//evil.example/phish)`)
	if strings.Contains(html, `href=`) {
		t.Fatalf("protocol-relative link kept: %s", html)
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
