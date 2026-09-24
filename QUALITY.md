# Quality

This bar covers the whole product: the symbol model, the site, the CLI, config, fixtures, and any doc that specifies behavior. A config flag is one decision among others. Rendering, navigation, comments, options, URLs, search, diff, and the pipeline that joins them are held to the same bar.

Repository layout, commands, and invariants live in [`AGENTS.md`](AGENTS.md).

## Quality target

The target is a correct explorer and a secure one, at the current practice for both.

- **Correctness.** The model, the site, and the CLI agree with the schema and the config after every pipeline pass.
- **State-of-the-art security.** Schema-controlled data is untrusted wherever it can reach HTML, a URL, a filesystem path, or client-side script. The bar is the current practice for that threat. It is not frozen at the allowlist from the day it was first written. When a sanitizer bypass, a new HTML or URL sink, or a path-escape technique becomes known, `renderSafeMarkdown`, `escapeHtml`, `sanitizeOutputPath`, and their tests move in the same change. A suite that is green only on yesterday's payloads misses this target.

In this repository that security target means:

- Comments and other schema text are rendered only through the sanitized HTML allowlist in `src/core/markdown.ts`. They are never compiled as MDX or JavaScript. Link schemes stay `http`, `https`, and `mailto`. Any new sink calls `renderSafeMarkdown` or `escapeHtml`.
- Output paths that contain `..` are rejected by `sanitizeOutputPath`.
- Plugins are trusted build code and load only from config. Schema comments and option values do not select modules to import.
- The site stays static. A private Git repository does not make the published pages private. Do not add a runtime that evaluates schema text.
- Dependencies that parse or sanitize untrusted input stay on releases that include the published fixes for those libraries. A bump that changes parsing or the allowlist updates the tests in the same change.

## Expected quality

A change is finished when all of these hold:

1. The behavior lives in the layer that owns it (see Where to change what in [`AGENTS.md`](AGENTS.md)). `SchemaModel` is the contract between the pipeline and the site. The site projects that model. A model field nothing reads is unfinished. A page that invents a fact the model does not have is unfinished.
2. Removing the behavior makes `npm test` fail. The assertion states the required outcome. Pasting today's output into the test records the current code, including a bug, and the suite stays green.
3. The result still holds after every later pass. `buildModel` classifies, then links, then may publish, then builds the symbol index. An early decision that a later pass puts back is not done.
4. The security target above still holds, and its tests still fail if the guard is removed. Comments stay sanitized HTML. Options stay data. Paths that contain `..` stay rejected. Plugins stay trusted build code, loaded only from config.
5. Root `tsc --noEmit` is clean. Generated files stay uncommitted (see Generated output in [`AGENTS.md`](AGENTS.md)).
6. CI still passes: `npm test`, typecheck, `doctor`, the Acme site build, and `pack:smoke`. Those jobs guard the whole build. A green Acme build does not prove one decision, because the checked-in Acme config uses defaults and the happy path.

## How to maintain it

Pick the smallest test that goes red when the change is reverted. Size is a resource constraint, from the test pyramid (many small tests, fewer medium, few large) and from Google's small / medium / large sizes. Choose the row by what the test is allowed to touch, then write the test inside that limit.

| Size | Allowed resources | What it is for | Where it lives |
|---|---|---|---|
| Small | One process. No socket, no sleep, no subprocess, no site build. | One function: parse, classify, sanitize, build a URL, shape a nav or source tree, group a field table, render an option, rank a search hit, accept or reject a path. | `src/**/*.test.ts` next to that module |
| Medium | Disk and localhost. Compiling a fixture with Buf is medium. | The model after every pass, when a later pass can publish, link, or index something an earlier pass rejected. Loading yaml. Writing an artifact file. | `src/model.test.ts` and `fixtures/` |
| Large | `buildDocumentation`, a browser, or the packed tarball. | The rendered page or the install layout, and only when a smaller test cannot see the failure. | CI builds Acme and runs `pack:smoke` |

Call the production function. A test that reimplements the condition stays green when that function is never called. A test that only reads a config value back has the same hole.

Add a proto under `fixtures/` when the case is about descriptors. Third-party option protos (`google.api`, `buf.validate`, and the same kind of dependency) are Buf dependencies. Do not vendor a copy under `examples/` to feed a test.

When the change is layout, routing, or rendered data, also use the page in a browser. That check confirms the projection. The small or medium test is what locks the decision. Walking the default Acme home page does not cover a branch that page never takes.

When you fix a bug, add the test that failed on the old code in the same change. Start at small size. Step up a row only when the failure is invisible there. A bug in a pure function that is caught only by reading HTML means the suite is aimed at the wrong layer, and the next similar bug will ship.

Security fixes and sanitizer updates are small tests of the function that enforces the control. `src/core/markdown.test.ts` and the hostile comment in `fixtures/security/` are the pattern. Extend those tests when the security target moves. A walk through the default Acme pages does not show that a comment payload was stripped.

`npm test` runs `vitest run`. The suite today is `src/model.test.ts`, `src/core/markdown.test.ts`, `src/core/field-table.test.ts`, `src/core/package-nav.test.ts`, `src/core/plugins.test.ts`, and `src/core/source-tree.test.ts`. `markdown.test.ts` is the pattern for an invariant: it calls `renderSafeMarkdown` and fails if a script tag survives. Add the next test at the size in the table.
