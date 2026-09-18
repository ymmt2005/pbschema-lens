import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  trailingSlash: "always",
  base: process.env.PBSCHEMA_LENS_BASE || "/",
  site: process.env.PBSCHEMA_LENS_SITE_URL || undefined,
  outDir: process.env.PBSCHEMA_LENS_OUT || "./dist",
  srcDir: "./src",
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "pbschema-lens/core": resolve(root, "../src/core/index.ts"),
      },
    },
  },
});
