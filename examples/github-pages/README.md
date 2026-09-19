# GitHub Pages

Copy `.github/workflows/protobuf-docs.yml` from `pbschema-lens init --github-pages`, or use this workflow in a schema repository:

1. Install pbschema-lens from the latest GitHub Release tarball (`releases/latest/download/pbschema-lens.tgz`). The generated workflow downloads that file and `npm install`s it locally.
2. Enable Pages with **Source: GitHub Actions**.
3. Set `base` to match how GitHub hosts the site, or let the generated workflow pass `--base` from `actions/configure-pages`.

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
