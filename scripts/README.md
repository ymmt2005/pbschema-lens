# Development checks

Use the exact Node runtime in `package.json` (`engines.node`) and Go patch release in `go.mod`. Buf, aqua, GoReleaser, and the agentic-workflow compiler are pinned in `.github/dependency-tools.json`. Install [aqua](https://aquaproj.github.io/docs/install/), then run from the repository root:

```sh
aqua install
npm ci
npm run test:links
```

`aqua.yaml` pins lychee v0.24.2 and the standard registry. `aqua-checksums.json` is committed and checksums are required. For an intentional tool update, change the pin, run `aqua update-checksum`, review the checksum changes, and rerun the checks. CI checks for committed-checksum changes after the link checks, including when they fail, so the guard covers both installer setup and later `aqua exec` calls. Never disable verification to resolve installation failures.

`test:links` first runs six checks against the real aqua-managed lychee: a valid document, a missing page, and a missing fragment at each base. The valid cases include an external `.invalid` URL that must be skipped offline. It then builds Acme at `/` and `/pbschema-lens/` and checks every generated HTML document, including fragment targets. External availability is not a PR gate, and there are no internal-link exclusions.

`build-test-sites.mjs` builds embedded assets, the CLI, and the descriptor. Outputs mirror deployment roots:

| Deployment | Filesystem root passed to lychee | Generated pages |
|---|---|---|
| `/` | `.pbschema-lens/test-sites/root/` | Inside that root |
| `/pbschema-lens/` | `.pbschema-lens/test-sites/project/` | Under its `pbschema-lens/` directory |

This lets root-relative links resolve offline without rewriting links or masking base-path mistakes. The checker uses `--offline`, the configured `include_fragments = "anchor-only"`, and `index_files = ["index.html"]`. Go tests retain page-identity/content and duplicate-ID checks; focused Go tests still assert renderer link generation.

Fresh markdown reports are written to `.pbschema-lens/link-reports/`. The regular CI test job publishes them in its summary and uploads them on failure. A failed checker remains a failing step after report collection. Generated files, test configuration, descriptors, binaries, and reports stay under the ignored `.pbschema-lens/` directory.

# Browser checks

```sh
npx playwright install --with-deps chromium
npm run test:e2e
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects an existing Chromium executable when needed. The same shared builder prepares both base paths and four focused root-based builds: descriptor-only, full-text disabled, WKT disabled, and a tiny real descriptor comparison. A separate test-only typography build runs on port 4178; its fixture stays out of the published Acme catalog. The test server starts and stops with Playwright; ports 4173–4178 must be free.

- Full offline link checks run at both bases, without a browser crawl.
- Native field/enum/source anchors and RPC navigation run at desktop and 320px. Bounding-box assertions check header clearance and viewport position, including field/enum/source reloads and same-page field navigation.
- Narrow User/Flag layouts check document-wide overflow and access to schema content. Text-range geometry checks representative field names, long types, and validation chips inside the table scroller and viewport. Intentional table/source/code scrolling is allowed; disclosure tests check active ancestors.
- Each configuration variant runs once at desktop width. Theme tests emulate system changes around explicit overrides and Follow desktop.
- Comment typography runs in light/dark themes at desktop and 320px. The real FieldMask page checks heading hierarchy, paragraph spacing, soft-wrap reflow, and compact code. The test-only specimen covers list markers, blockquotes, inline code, and reachable wide code/table content through local scrollers. Assertions use computed styles and text geometry; there are no screenshot goldens.
- Existing no-JavaScript checks remain at both bases, and the 390px drawer check remains.

Every browser test imports `e2e/fixtures.ts`. Its automatic monitor fails on JavaScript errors, failed same-origin requests, and HTTP error responses; diagnostics are attached to the Playwright result. Intentional 404 navigations declare their exact pathname/status in that test's `allowedHTTPFailures` list. API requests explicitly used to assert omitted files are tested directly. The JSON-blocking navigation test expects no JSON requests at all, so an unexpected aborted request still fails. Third-party font/network availability is outside this monitor's same-origin scope.

Failure screenshots and retry traces remain in `e2e/.results/` and are uploaded by the E2E job. External link availability checks are an optional separate workflow, not part of these commands.

# Monthly dependency updates

[GitHub Agentic Workflows](https://github.github.com/gh-aw/) runs Codex at 12:17 JST
(03:17 UTC) on the first day of each month, or through **Actions → Monthly dependency updates
→ Run workflow**. It prepares at most one draft PR; merging stays manual. There is
no Renovate configuration. Source lives in
`.github/workflows/update-dependencies.md`; its compiled `.lock.yml` is committed.

The deterministic helper, rather than the agent's judgment, selects versions:

- Require 72 hours since publication; ignore prereleases, drafts, deprecated npm
  releases, future dates, and missing evidence. Date-only Go/Node release dates
  wait until the end of the publication day plus 72 hours.
- Go uses `go.mod` and skips every `1.x.0`. Node uses the exact `engines.node`
  in `package.json`, selects LTS, and skips the first LTS-designated release in
  each major line. `@types/node` follows the selected Node major.
- npm uses registry publication times, including every new transitive lockfile
  entry. Tool/aqua updates use GitHub Release publication times. Go toolchains
  use the official release history and Node uses the official distribution index.
- A Go module's proxy timestamp can be an old commit date, so it cannot establish
  release age. Query the GitHub Release for the exact tag and use `published_at`
  when it exists. A Release still under embargo waits without adding an observation.
  Only when the Release is absent, add its version
  to `.github/dependency-observations.json` in a PR first. Only an observation
  already in the trusted base can qualify, after the commit that last changed
  that inventory has aged 72 hours. Adding observations conservatively resets
  that clock for the whole inventory. A later manual/monthly run can apply the
  update. New unaged Go transitives hold the Go dependency bump and get observed
  for a later run; other updates may proceed.
- Preserve existing Go/npm/aqua checksums. New npm/aqua artifacts must match
  upstream digests. Go's native download also checks `go.sum` against the checksum
  database.

Automatic scope includes Go/Node runtimes, Go/npm dependencies, aqua and its
registry/packages, Buf, and GoReleaser. GitHub Actions and the agentic-workflow
compiler remain fixed for manual maintenance. Automated patches cannot change
workflow files, the Actions lock cache, or the compiler version/checksum. Buf's
version in the CLI's generated Pages template is the only permitted Go source
edit; its Action pins stay unchanged.

Local commands (Linux amd64 for compilation):

```sh
npm run test:updates
node scripts/dependency-updates.mjs plan
node scripts/dependency-updates.mjs apply
node scripts/dependency-updates.mjs compile
node scripts/dependency-updates.mjs verify "$(git rev-parse origin/main)"
```

`plan` writes its report under the ignored `.pbschema-lens/dependency-updates/`.
`apply` recomputes the plan, refreshes lockfiles without npm lifecycle scripts,
and refreshes aqua checksums without regenerating workflow files. For intentional
manual workflow edits, `compile` downloads the compiler from its pinned official
release and checks both its committed SHA-256 and the GitHub asset digest. Compilation preserves Action version comments and reads
Node from `package.json`, including the framework's runtime setup. The detection
job checks out that manifest even for a no-change run. Runtime Codex
installation uses npm's 72-hour cutoff too. A compiler update that adds new
secrets or Actions stops for human security review. Never automatically approve
that warning or edit the generated jobs by hand. Failed compilation restores its
previous outputs. Compiler upgrades and new workflow access require a separate
human-reviewed change.

The monthly updater's post-step runs the checker from its immutable starting
commit against the candidate patch. The agent's edits cannot replace the checker
used for this validation. Updates have a strict file/content allowlist that
excludes all workflow files and compiler pins. This step must pass before safe
outputs can publish a PR. Browser prerequisites are installed before the agent
starts; its network policy allows Playwright downloads and the Buf registry.
The publishing/reporting jobs use the repository's built-in `GITHUB_TOKEN`.
After a PR is created, the conclusion job dispatches `ci.yml` on its same-repository
`deps/` branch. GitHub allows `workflow_dispatch` with this token even though its
PR/push events do not automatically start workflows. No-change runs dispatch
nothing. CI runs unit, type, Go, link, and browser tests; its existing deployment
guards skip Pages deployment on the update branch. Updates requiring application
or policy changes are held for a separate PR.

## Enable the workflow

After merging this implementation:

1. Add repository secret `OPENAI_API_KEY` for Codex inference.
2. In **Settings → Actions → General → Workflow permissions**, enable
   **Allow GitHub Actions to create and approve pull requests**. The updater
   requests the write permissions needed for publishing and CI dispatch only in
   the framework's publishing/reporting jobs; the agent's token stays read-only.
3. Run the workflow manually once and inspect the draft PR and CI before relying
   on the monthly schedule. First-seen Go observations can need an initial merge
   and a second run at least 72 hours later.

Store credentials only in repository settings, never in files or PR bodies. A
compiler validation/local dry run does not validate inference or PR publication;
those require the repository API key, PR-creation setting, and a real workflow run.
