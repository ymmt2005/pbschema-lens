# Development checks

Use the exact Node runtime in `package.json` (`engines.node`) and Go patch release in `go.mod`. Buf, aqua, and GoReleaser are pinned in `.github/dependency-tools.json`. Install [aqua](https://aquaproj.github.io/docs/install/), then run from the repository root:

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

The regular GitHub Actions workflow `.github/workflows/update-dependencies.yml`
runs at 12:17 JST (03:17 UTC) on the first day of each month, or manually with
`workflow_dispatch`. It uses deterministic Node scripts and the built-in
`GITHUB_TOKEN`. There is no agent, inference API key, GitHub App, PAT, or Renovate.

The selector enforces:

- A 72-hour embargo; prereleases, drafts, deprecated npm releases, future dates,
  and missing evidence are ineligible. Date-only Go/Node release dates wait until
  the end of the publication day plus 72 hours.
- Go comes from the exact `go` directive in `go.mod` and skips every `1.x.0`.
  Node comes from exact `engines.node` in `package.json`, selects LTS, and skips
  the first LTS-designated release in each major line. `@types/node` follows the
  selected Node major. The setup Actions read those same manifests.
- npm uses registry publication times for every new lockfile version, including
  transitives. Tools and aqua use GitHub Release publication times. Go toolchains
  use the official release history; Node uses the official distribution index.
- Go modules prefer the exact tag's GitHub Release `published_at`. A fresh or
  draft Release cannot be bypassed with an older Git date. Without a Release,
  use the annotated tag's tagger date, or the target commit's committer date for
  lightweight tags. Modules without a known GitHub mapping use the Go proxy's
  commit timestamp. Missing or invalid dates still hold the update.
- **Accepted timestamp risk:** Git dates can be backdated, and a new lightweight
  tag can point to an old commit. These dates do not prove 72 hours of public
  availability. The generated PR identifies fallback sources and explains the
  risk. New Go transitives undergo the same age checks; an ineligible transitive
  holds the Go dependency bump while other updates proceed.
- Discover and explicitly upgrade only direct Go requirements. Never target
  `// indirect` requirements or use `go get -u`. Run `go mod tidy` only after a
  direct update; indirect requirements and Go checksums may change as its
  consequences. Runtime-only updates do not refresh Go dependencies.
- Preserve existing Go/npm/aqua checksum values. New npm/aqua artifacts must
  match upstream digests. Go's native download also verifies the checksum database.

Automatic scope includes Go/Node runtimes, direct Go requirements, npm
dependencies, aqua and its registry/packages, Buf, and GoReleaser. GitHub Actions
are maintained manually. Their pins live in `.github/workflows/`, where GitHub
requires additional workflow-write access. The built-in `GITHUB_TOKEN` cannot
be granted that access; `actions: write` permits operations on workflow runs,
not editing workflow files. Using a regular workflow does not change this limit.
Automatically publishing those changes would require an App token or PAT with
workflow-write access, outside this updater's token-only authentication policy.
See [GitHub's file-update requirements](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
and [available token permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

Automated patches cannot change workflow files, policy
scripts, package scripts, application version, or application code. Only the Buf
CLI version in the generated Pages template may change in Go source.

The read-only `prepare` job skips runs while a same-repository `deps/monthly-`
PR against `main` remains open. Otherwise it applies eligible updates, verifies
scope/age/checksums, activates the candidate's Go, Node, aqua and Buf versions,
and runs npm installation, policy/unit/Go tests, typechecks, UI build, offline
links and Playwright. A second policy check runs after the tests. Only a successful,
nonempty candidate is uploaded as a patch artifact. No-change runs open no PR;
failures stop the run and require human investigation rather than code edits or
weakened checks.

A separate `publish` job has the write permissions. It checks out the exact tested
base and loads its trusted built-in-only scripts before applying the artifact.
It revalidates the patch, then pushes a unique `deps/monthly-<run>-<attempt>`
branch and opens a draft PR. It checks again for an existing update PR and never
force-pushes or rewrites review edits. The PR body is generated from actual version
and lockfile changes with timestamps, fallback risks, checksum counts, and a link
to preparation logs for results and held candidates. No dependency installation or
test execution runs with the publishing token.

Since `GITHUB_TOKEN` PR/push events do not start workflows, publication explicitly
dispatches `ci.yml` on the update branch. CI's existing guards skip Pages deployment
there. This workflow never approves or merges PRs. A run stops if PR creation or CI
dispatch fails; if publication succeeded before dispatch failed, CI can be run
manually on the published branch.

Local commands:

```sh
npm run test:updates
node scripts/dependency-updates.mjs plan
node scripts/dependency-updates.mjs apply
node scripts/dependency-updates.mjs verify "$(git rev-parse HEAD)" --updates-only
node scripts/dependency-updates.mjs report "$(git rev-parse HEAD)"
```

`plan` writes its report under ignored `.pbschema-lens/dependency-updates/`.
`apply` recomputes the plan, refreshes the npm lockfile without lifecycle scripts,
and refreshes aqua checksums. `report` describes the current candidate; it does
not execute tests. To validate manual Action-pin maintenance, use `verify` without
`--updates-only`; it also checks SHA/version comments against GitHub tags.

## Enable the workflow

After merging, enable **Settings → Actions → General → Workflow permissions →
Allow GitHub Actions to create and approve pull requests**, then run the workflow
manually on `main` and inspect its draft PR and CI. GitHub combines creation and
approval in one switch; it has no creation-only setting. The workflow creates PRs
and contains no approval or merge calls. No additional repository secret is needed.

Local tests and API-stub publication tests do not validate actual token-based PR
creation or downstream CI dispatch; those require a real workflow run with that
repository setting enabled.
