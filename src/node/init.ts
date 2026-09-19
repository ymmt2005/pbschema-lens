import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function initProject(cwd: string, options: { githubPages?: boolean }): Promise<string[]> {
  const written: string[] = [];
  const config = `title: "Protobuf API"
input: "."
output: "dist"
base: "/"

source:
  # Set this to emit "View on GitHub" links, e.g. github:org/repo
  # repository: "github:org/repo"

documentation:
  include: []
  exclude:
    - "third_party/**"

wellKnownTypes:
  enabled: true

search:
  symbolIndex: true
  fullText: true

sourceBrowser:
  enabled: true

artifacts:
  descriptorSet: false
  symbolIndex: true

# externalLinks:
#   - package: "acme.identity.**"
#     urlTemplate: "https://docs.example.com/identity/reference/{symbol}"
`;
  await writeFile(join(cwd, "pbschema-lens.yaml"), config);
  written.push("pbschema-lens.yaml");

  if (options.githubPages) {
    const workflowDir = join(cwd, ".github/workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflow = `name: Protobuf Documentation

on:
  push:
    branches: [main]
    paths:
      - "**/*.proto"
      - "buf.yaml"
      - "buf.lock"
      - "pbschema-lens.yaml"
      - ".github/workflows/protobuf-docs.yml"

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: https://npm.pkg.github.com
          scope: "@ymmt2005"
      - name: Install
        run: npm ci
      - name: Install pbschema-lens
        run: npm install --no-save @ymmt2005/pbschema-lens
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
      - name: Configure Pages
        id: pages
        uses: actions/configure-pages@v5
      - name: Build protobuf documentation
        env:
          PAGES_BASE_PATH: \${{ steps.pages.outputs.base_path }}
        run: |
          base="\${PAGES_BASE_PATH:-/}"
          case "$base" in
            /) ;;
            */) ;;
            *) base="\${base}/" ;;
          esac
          npx pbschema-lens build . --out dist --base "$base"
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
`;
    await writeFile(join(workflowDir, "protobuf-docs.yml"), workflow);
    written.push(".github/workflows/protobuf-docs.yml");
  }
  return written;
}
