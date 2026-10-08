import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev:web` proxies the API to a running `portolan serve` (default port 4310).
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:4310" } },
});
