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

[GitHub Agentic Workflows](https://github.github.com/gh-aw/) runs Codex at 03:17 UTC
on the first day of each month, or through **Actions → Monthly dependency updates
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
  entry. Actions/tools/aqua use GitHub Release publication times. Go toolchains
  use the official release history and Node uses the official distribution index.
- A Go module's proxy timestamp can be an old commit date, so it cannot establish
  release age. Prefer a GitHub Release publication time. Otherwise add its version
  to `.github/dependency-observations.json` in a PR first. Only an observation
  already in the trusted base can qualify, after the commit that last changed
  that inventory has aged 72 hours. Adding observations conservatively resets
  that clock for the whole inventory. A later manual/monthly run can apply the
  update. New unaged Go transitives hold the Go dependency bump and get observed
  for a later run; other updates may proceed.
- Resolve Action tags to commits, including annotated tags, and use full SHAs
  followed by matching exact version comments. Preserve existing Go/npm/aqua
  checksums. Newly added npm/aqua/compiler artifacts must match upstream digests.
  Go's native download also checks `go.sum` against the checksum database.

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
refreshes aqua checksums, and recompiles. The compiler is downloaded from its
pinned official release and checked against both its committed SHA-256 and the
GitHub asset digest. Compilation preserves Action version comments and reads
Node from `package.json`, including the framework's runtime setup. Runtime Codex
installation uses npm's 72-hour cutoff too. A compiler update that adds new
secrets or Actions stops for human security review. Never automatically approve
that warning or edit the generated jobs by hand.

An independent **Dependency release policy / dependency-policy** check runs on
`pull_request_target` with read-only permissions. It checks out the immutable base
and candidate separately, executes only the base's checker, and treats candidate
files as data. All PRs get release/checksum/Action checks. Branches beginning
`deps/` additionally have a strict file/content allowlist and must reproduce the
compiled workflow byte for byte. The updater's own post-step must pass before
safe outputs can publish. Regular CI runs unit, type, Go, link, and browser tests.
Updates requiring application/policy changes are held for a separate PR.

## Enable the workflow

After merging this implementation:

1. Add repository secret `OPENAI_API_KEY` for Codex inference.
2. Install a GitHub App on this repository with **Contents: read/write**,
   **Pull requests: read/write**, **Issues: read/write** (requested by the
   framework for PR/report handling), and **Workflows: read/write**. Add its client ID
   as repository variable `DEPENDENCY_APP_ID` and its PEM private key as secret
   `DEPENDENCY_APP_PRIVATE_KEY`. Only the framework's publishing/reporting jobs receive that key; the
   agent receives a read-only repository token. The App is needed because the
   ordinary `GITHUB_TOKEN` cannot publish workflow-file updates and its pushes
   would not trigger the normal PR checks.
3. Make **Dependency release policy / dependency-policy** required in branch
   protection/rulesets alongside normal CI checks. The workflow must first exist
   on the default branch; it cannot protect its own introduction PR.
4. Run the workflow manually once and inspect the draft PR and CI before relying
   on the monthly schedule. First-seen Go observations can need an initial merge
   and a second run at least 72 hours later.

Store credentials only in repository settings, never in files or PR bodies. A
compiler validation/local dry run does not validate inference or PR publication;
those require the configured repository credentials and a real workflow run.
