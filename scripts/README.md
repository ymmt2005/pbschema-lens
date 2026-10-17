# Development checks

Use Node >=24, Go >=1.26, and Buf. Install [aqua](https://aquaproj.github.io/docs/install/) (CI pins v2.63.0), then run from the repository root:

```sh
aqua install
npm ci
npm run test:links
```

`aqua.yaml` pins lychee v0.24.2 and the standard registry. `aqua-checksums.json` is committed and checksums are required. For an intentional tool update, change the pin, run `aqua update-checksum`, review the checksum changes, and rerun the checks. CI fails if installation changes the committed checksums. Never disable verification to resolve installation failures.

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

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects an existing Chromium executable when needed. The same shared builder prepares both base paths and four focused root-based builds: descriptor-only, full-text disabled, WKT disabled, and a tiny real descriptor comparison. The test server starts and stops with Playwright; ports 4173–4177 must be free.

- Full offline link checks run at both bases, without a browser crawl.
- Native field/enum/source anchors and RPC navigation run at desktop and 320px. Bounding-box assertions check header clearance and viewport position, including field/enum/source reloads and same-page field navigation.
- Narrow User/Flag layouts check document-wide overflow and access to schema content. Text-range geometry checks representative field names, long types, and validation chips inside the table scroller and viewport. Intentional table/source/code scrolling is allowed; disclosure tests check active ancestors.
- Each configuration variant runs once at desktop width. Theme tests emulate system changes around explicit overrides and Follow desktop.
- Existing no-JavaScript checks remain at both bases, and the 390px drawer check remains.

Every browser test imports `e2e/fixtures.ts`. Its automatic monitor fails on JavaScript errors, failed same-origin requests, and HTTP error responses; diagnostics are attached to the Playwright result. Intentional 404 navigations declare their exact pathname/status in that test's `allowedHTTPFailures` list. API requests explicitly used to assert omitted files are tested directly. The JSON-blocking navigation test expects no JSON requests at all, so an unexpected aborted request still fails. Third-party font/network availability is outside this monitor's same-origin scope.

Failure screenshots and retry traces remain in `e2e/.results/` and are uploaded by the E2E job. External link availability checks are an optional separate workflow, not part of these commands.
