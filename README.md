# pbschema-lens

[![CI](https://github.com/ymmt2005/pbschema-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/ymmt2005/pbschema-lens/actions/workflows/ci.yml)

An open-source **static schema explorer for Protocol Buffers**.

Point it at a Buf workspace, a directory of `.proto` files, or a `FileDescriptorSet`, and it produces a static site you can host on GitHub Pages (or anywhere else). There is no documentation server, no database, and no hosted schema registry.

The generated site is a graph over the schema: services, RPCs, messages, fields, enums, extensions, custom options, well-known types, reverse "used by" references, and two-layer search.

A live build of the bundled [`examples/acme`](examples/acme) API is on [GitHub Pages](https://ymmt2005.github.io/pbschema-lens/):

<p align="center">
  <a href="https://ymmt2005.github.io/pbschema-lens/">
    <img src="docs/screenshots/home.png" alt="Home page of the generated Acme Protobuf API docs" width="900">
  </a>
</p>

## Quick start

```bash
npm install
npx tsx src/cli.ts build examples/acme --out examples/acme/dist
```

Then open `examples/acme/dist/index.html`, or serve it:

```bash
npx tsx src/cli.ts dev examples/acme --port 43147
```

Against an existing descriptor set:

```bash
npx tsx src/cli.ts build schema.binpb --out dist
```

## Install from a GitHub Release

This is a build-time CLI, not a library. It requires **Node 24+**. Prefer a pinned download over a `package.json` dependency.

Each GitHub Release **Assets** list includes an `npm pack` tarball we attach after `tsc`. That file already contains compiled `dist/` (no install scripts). Download it from `/releases/download/…`:

```bash
curl -fsSL -o pbschema-lens.tgz \
  https://github.com/ymmt2005/pbschema-lens/releases/download/v0.4.0/pbschema-lens-0.4.0.tgz
npm install --no-save ./pbschema-lens.tgz
npx pbschema-lens build .
```

This repository uses GitHub [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases): once a Release is published, its Git tag and attached assets cannot be changed or replaced.

The same page also shows **Source code (tar.gz)** and **Source code (zip)**. Those are not our pack. GitHub always adds them when a tag exists: they are a snapshot of the git tree (`/archive/refs/tags/v0.4.0.tar.gz`), TypeScript sources only. The CLI bin is `./dist/cli.js`, so installing that archive does not give you a working `pbschema-lens`. Use the Assets file named `pbschema-lens-0.4.0.tgz`.

A stable name `pbschema-lens.tgz` is also uploaded for `releases/latest/download/pbschema-lens.tgz`. Pin a versioned URL when you care about reproducibility.

## CLI

| Command | Purpose |
|---|---|
| `pbschema-lens build [input]` | Compile the schema and emit a static site |
| `pbschema-lens dev [input]` | Rebuild on proto changes and preview locally |
| `pbschema-lens doctor [input]` | Check Buf, compilation, options, and source-link config |
| `pbschema-lens diff --against <file>` | Compare two schemas and attach a diff page |
| `pbschema-lens init [--github-pages]` | Write `pbschema-lens.yaml` and an optional Pages workflow |

`input` can be:

- a Buf module / workspace (`buf.yaml`)
- a directory of `.proto` files
- a `FileDescriptorSet` (`*.binpb`, `*.pb`, `*.desc`)

## Configuration

The config file is `pbschema-lens.yaml` or `pbschema-lens.yml`, next to the input or in the working directory. `--config` selects a file explicitly.

```yaml
title: "Acme Protobuf API"
input: "."
output: "dist"
base: "/"
siteUrl: "https://docs.example.com"

source:
  repository: "github:org/repo"
  commit: "abc123"
  urlTemplate: "https://src.example/{commit}/{file}#L{line}"

documentation:
  include:
    - "acme/**"
  exclude:
    - "third_party/**"

wellKnownTypes:
  enabled: true

search:
  fullText: true

sourceBrowser:
  enabled: true

artifacts:
  descriptorSet: false
  references: true

externalLinks:
  - package: "acme.identity.**"
    urlTemplate: "https://docs.example.com/identity/reference/{symbol}"

plugins:
  - "./my-plugin.mjs"
```

| Key | Default | Effect |
|---|---|---|
| `title` | `Protobuf API` | Site title. `build`, `dev`, and `diff` accept `--title`. |
| `input` | `.` | Buf workspace, proto directory, or `FileDescriptorSet`. The command's `[input]` argument overrides this. |
| `output` | `dist` | Output directory. Those commands accept `--out`. |
| `base` | `/` | Path prefix for the site. A public GitHub project site uses `/<repo>/`. A private Pages site, a user or org site, or a custom domain uses `/`. Those commands accept `--base`. |
| `siteUrl` | omitted | Origin of the published site, such as `https://docs.example.com`. The build emits a canonical link for each page. With `base: /docs/`, the home page canonical URL is `https://docs.example.com/docs/`. |
| `source.repository` | omitted | Repository for the separate “View on GitHub” or “View on GitLab” link. `github:owner/repo` and `https://github.com/owner/repo` (optional `.git`) build a GitHub blob URL. `gitlab:group/project` and `https://gitlab.com/group/project` build a GitLab blob URL. When `.proto` text is available, View source stays in the site and this link is separate. When it is not, View source uses this URL. |
| `source.commit` | git commit of the schema, or `HEAD` | Commit used in the repository link. A value here overrides the commit detected from the worktree. |
| `source.urlTemplate` | omitted | Repository link template. When set, this string is used instead of `source.repository`. `{file}` is the proto path, `{line}` is the line number, and `{commit}` is `source.commit`, then the detected git commit, then `HEAD`. Example: `https://src.example/{commit}/{file}#L{line}`. |
| `documentation.include` | omitted | Proto path globs or package names. A package pattern ending in `.**` includes nested packages. A non-empty list documents only matching files. Other files have no page and do not appear in symbol search. |
| `documentation.exclude` | omitted | Proto path globs or package names. Matching files are left out of the site: no page, no source, no symbol-search hit, and no link to or from their symbols. A message that uses an option from an excluded file still shows that option chip, without a definition link. |
| `wellKnownTypes.enabled` | `true` | `false` drops every well-known type page and nav entry, including Timestamp and Duration. Descriptor and feature protos stay hidden either way. A field of that type keeps the type name as text. |
| `search.fullText` | `true` | `false` skips the Pagefind index. Symbol search is always written to `assets/protobuf/symbols.json`. |
| `sourceBrowser.enabled` | `true` | `false` does not load `.proto` text, so the site has no source pages. |
| `artifacts.descriptorSet` | `false` | `true` writes `assets/protobuf/schema.binpb`. |
| `artifacts.references` | `true` | `false` skips `assets/protobuf/references.json`. `symbols.json` and `build-info.json` are written on every build. |
| `externalLinks` | omitted | Rules that send a package to another site. `package` is a name or a `.**` pattern. A match is documented externally: no local page, and links use `urlTemplate`. `{symbol}` is the full name, `{kind}` is the symbol kind, and `{package}` is the package. |
| `plugins` | omitted | Trusted Node modules, resolved from the working directory. Each file exports a plugin (`default` or `plugin`). Schema comments cannot name a plugin. |

`build`, `dev`, and `diff` accept `--out`, `--base`, `--title`, and `--config`. `build` and `diff` accept `--against`; `diff` requires it. `dev` accepts `--port`. A flag applies on the commands that declare it.

## What the site includes

- Package, service, RPC, message, field, oneof, enum, and extension pages
- Arbitrary custom options, including definition pages and usage backlinks
- Built-in documentation for Protocol Buffers well-known types
- Forward links and reverse "Used by" references
- Editions effective-feature display
- Specialized renderers for `google.api.http`, `buf.validate`, `cybozu.validate`, field behavior, and `deprecated`
- Field tables show `buf.validate` and `cybozu.validate` rules in a dedicated Validation column
- Symbol search (exact / prefix / fuzzy) plus Pagefind full-text search
- Optional embedded source browser
- Schema diff + `buf breaking` integration when `--against` is set
- Machine-readable `assets/protobuf/*.json` artifacts

## Architecture

Compilation is Buf's job. pbschema-lens consumes `google.protobuf.FileDescriptorSet`, builds a renderer-independent symbol model with Protobuf-ES, then emits an Astro static site. Starlight is not used: pages are generated from the model via `getStaticPaths()`, not from markdown files.

Comments are treated as untrusted data. They are rendered as Markdown with a sanitized HTML allowlist. They are never compiled as MDX or JavaScript.

## Security notes

The security target is current practice for a static site built from untrusted schema text. When a sanitizer bypass or a new HTML, URL, or path sink becomes known, the allowlist and its tests move with it. The full bar is [`QUALITY.md`](QUALITY.md).

- A private Git repository does **not** make a published static site private.
- Plugins run as trusted build code.
- Source paths are rejected if they contain `..`.

## Develop

```bash
npm test
npx tsc -p tsconfig.json --noEmit
npx tsx src/cli.ts doctor examples/acme
```

The example API lives in `examples/acme` and is published to [GitHub Pages](https://ymmt2005.github.io/pbschema-lens/) after CI tests pass. The `pbschema-lens init --github-pages` template is documented in `examples/github-pages`.

To cut a GitHub Release, bump the version in a PR (`package.json`, lockfile, CLI `--version`, and the install URL) and squash-merge it to `main`. The **Release tarball** workflow sees that squash commit’s `package.json` version change, tags `vX.Y.Z`, and publishes both pack files. Do not create the tag or the Release by hand. Do not delete a published tag or Release: GitHub will not let you reuse that tag name. If the version is wrong, bump to the next patch and merge that.
