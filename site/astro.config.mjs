import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  trailingSlash: "always",
  base: process.env.PROTOLENS_BASE || "/",
  site: process.env.PROTOLENS_SITE_URL || undefined,
  outDir: process.env.PROTOLENS_OUT || "./dist",
  srcDir: "./src",
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "protolens/core": resolve(root, "../src/core/index.ts"),
      },
    },
  },
});
