import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/__PBSCHEMA_BASE__/",
  plugins: [tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../internal/site/dist", import.meta.url)),
    emptyOutDir: true,
  },
});
