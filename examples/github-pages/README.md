# GitHub Pages

Copy `.github/workflows/protobuf-docs.yml` from `pbschema-lens init --github-pages`, or use this workflow in a schema repository:

1. Download the GoReleaser archive for the runner, not GitHub’s “Source code” `/archive/…` snapshot. The generated workflow downloads `pbschema-lens_linux_amd64.tar.gz` from `releases/latest/download` and installs the binary on `PATH`. Pin `/releases/download/vX.Y.Z/pbschema-lens_linux_amd64.tar.gz` when you care about reproducibility. Windows archives are `.zip` and the binary is `pbschema-lens.exe`. Other names follow `pbschema-lens_<os>_<arch>`.
2. Enable Pages with **Source: GitHub Actions**.
3. Set `base` to match how GitHub hosts the site, or let the generated workflow pass `--base` from `actions/configure-pages`.

The build step compiles the schema with Buf and pipes the descriptor set:

```bash
buf build -o - --as-file-descriptor-set | pbschema-lens build --out dist --base "$base" --commit "$GITHUB_SHA"
```

The generated workflow does not pass `--source`. Add `--source <dir>` yourself when the in-site source browser should include `.proto` text. pbschema-lens does not guess a source directory, and it does not invoke Buf.

## `base` path

| How the site is published | Typical URL | `base` |
|---|---|---|
| Public project site | `https://<owner>.github.io/<repository>/` | `/<repository>/` |
| Privately published site | unique `https://<random>.pages.github.io/` | `/` |
| User or organization site | `https://<owner>.github.io/` | `/` |
| Custom domain | `https://docs.example.com/` | `/` |

A **privately published** Pages site (GitHub Enterprise Cloud, site visibility Private — the usual setting for private schema repositories) is not served from `github.io/<repository>/`. GitHub assigns a random `*.pages.github.io` hostname so the site has its own origin. That host serves the site at `/`, so `base: "/<repository>/"` will break links. The hostname is shown under **Settings → Pages**.

The generated workflow calls `actions/configure-pages` and passes `base_path` to `pbschema-lens build --base`, which covers public project sites, private unique hosts, and custom domains without hardcoding the repository name.

Pin third-party GitHub Actions to commit SHAs in security-sensitive repositories.
