import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { thirdPartyLicenses } from "./licenses.ts";

// `pnpm dev:web` proxies the API to a running `portolan serve` (default port 4310).
export default defineConfig({
  plugins: [react(), thirdPartyLicenses()],
  // Relative asset URLs, so the same build works at / and under a GitHub Pages project path.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:4310" } },
});
