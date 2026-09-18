# GitHub Pages

Copy `.github/workflows/protobuf-docs.yml` from `pbschema-lens init --github-pages`, or use this workflow in a schema repository:

1. Install pbschema-lens as a dev dependency (or invoke it via `npx` after publish).
2. Set `base: "/<repository-name>/"` in `pbschema-lens.yaml` for project Pages.
3. Leave `base: "/"` for a custom domain.

Pin third-party GitHub Actions to commit SHAs in security-sensitive repositories.
