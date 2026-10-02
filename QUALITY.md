# Quality

This bar covers the whole product: the symbol model, the site, the CLI, config, fixtures, and any doc that specifies behavior. A config flag is one decision among others. Rendering, navigation, comments, options, URLs, search, diff, and the pipeline that joins them are held to the same bar.

Repository layout, commands, and invariants live in [`AGENTS.md`](AGENTS.md).

## Quality target

The target is a correct explorer and a secure one, at the current practice for both.

- **Correctness.** The model, the site, and the CLI agree with the schema and the config after every pipeline pass.
- **State-of-the-art security.** Schema-controlled data is untrusted wherever it can reach HTML, a URL, a filesystem path, or client-side script. The bar is the current practice for that threat. It is not frozen at the allowlist from the day it was first written. When a sanitizer bypass, a new HTML or URL sink, or a path-escape technique becomes known, `RenderSafe`, `EscapeHTML`, `renderSafeMarkdown`, `escapeHtml`, the output `os.Root` boundary, and their tests move in the same change. A suite that is green only on yesterday's payloads misses this target.

In this repository that security target means:

- Comments and other schema text are rendered only through the sanitized HTML allowlist in `internal/markdown`. They are never compiled as MDX or JavaScript. Link schemes stay `http`, `https`, and `mailto`. `src/core/markdown.ts` keeps the same allowlist for browser `escapeHtml` and the vitest suite. Any new sink calls `RenderSafe` / `EscapeHTML` on the Go path, or `renderSafeMarkdown` / `escapeHtml` on the TypeScript path.
- Descriptor, config, and source paths may contain `..`. Generated-site writes go through an `os.Root` in `internal/site` and refuse a filesystem root, the working directory, or an ancestor of the working directory. `base` is a same-origin URL path.
- Plugins are not loaded. A non-empty `plugins` list fails the build. Schema comments and option values do not select modules to import.
- The site stays static. A private Git repository does not make the published pages private. The `pbschema-lens` process does not evaluate schema text, and it does not run Node, JavaScript, or WebAssembly.
- Dependencies that parse or sanitize untrusted input stay on releases that include the published fixes for those libraries. A bump that changes parsing or the allowlist updates the tests in the same change.

## Expected quality

A change is finished when all of these hold:

1. The behavior lives in the layer that owns it (see Where to change what in [`AGENTS.md`](AGENTS.md)). `SchemaModel` is the contract between the pipeline and the site. The site projects that model. A model field nothing reads is unfinished. A page that invents a fact the model does not have is unfinished.
2. Removing the behavior makes `npm test` or `go test ./...` fail. The assertion states the required outcome. Pasting today's output into the test records the current code, including a bug, and the suite stays green.
3. The result still holds after every later pass. Model build classifies, then links, then may publish, then builds the symbol index. An early decision that a later pass puts back is not done.
4. The security target above still holds, and its tests still fail if the guard is removed. Comments stay sanitized HTML. Options stay data. Site output stays inside its `os.Root` and still refuses the working directory and filesystem root. Plugins stay unloaded.
5. Root `tsc --noEmit` and `ui/tsconfig.json` are clean. Generated files stay uncommitted (see Generated output in [`AGENTS.md`](AGENTS.md)). `npm run build:ui` has refreshed `internal/site/dist` before `go test` or `go build`.
6. CI still passes: `npm test`, typecheck, `npm run build:ui`, `go test ./...`, `doctor`, and the Acme site build. Those jobs guard the whole build. A green Acme build does not prove one decision, because the checked-in Acme config uses defaults and the happy path.

## How to maintain it

Pick the smallest test that goes red when the change is reverted. Size is a resource constraint, from the test pyramid (many small tests, fewer medium, few large) and from Google's small / medium / large sizes. Choose the row by what the test is allowed to touch, then write the test inside that limit.

| Size | Allowed resources | What it is for | Where it lives |
|---|---|---|---|
| Small | One process. No socket, no sleep, no subprocess, no site build. | One function: parse, classify, sanitize, build a URL, shape a nav or source tree, group a field table, render an option, rank a search hit, accept or reject a path. | `src/**/*.test.ts` or `internal/**/*_test.go` next to that module |
| Medium | Disk and localhost. Compiling a fixture with Buf is medium. | The model after every pass, when a later pass can publish, link, or index something an earlier pass rejected. Loading yaml. Writing an artifact file. | `internal/model/build_test.go` and `fixtures/` |
| Large | `pipeline.Build`, a browser, or a release archive. | The rendered page, and only when a smaller test cannot see the failure. | CI builds Acme. Browser checks cover layout and routing. |

Call the production function. A test that reimplements the condition stays green when that function is never called. A test that only reads a config value back has the same hole.

Add a proto under `fixtures/` when the case is about descriptors. Third-party option protos (`google.api`, `buf.validate`, and the same kind of dependency) are Buf dependencies. Do not vendor a copy under `examples/` to feed a test. Go model tests invoke `buf` (or `$BUF`) to produce the descriptor set. The product binary does not.

When the change is layout, routing, or rendered data, also use the page in a browser. That check confirms the projection. The small or medium test is what locks the decision. Walking the default Acme home page does not cover a branch that page never takes.

When you fix a bug, add the test that failed on the old code in the same change. Start at small size. Step up a row only when the failure is invisible there. A bug in a pure function that is caught only by reading HTML means the suite is aimed at the wrong layer, and the next similar bug will ship.

Security fixes and sanitizer updates are small tests of the function that enforces the control. `internal/markdown/markdown_test.go`, `src/core/markdown.test.ts`, and the hostile comment in `fixtures/security/` are the pattern. Extend those tests when the security target moves. A walk through the default Acme pages does not show that a comment payload was stripped.
