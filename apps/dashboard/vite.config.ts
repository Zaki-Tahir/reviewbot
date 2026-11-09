import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In AWS, CloudFront serves the app and /api from one domain. Locally, Vite proxies /api
    // to the dev server so cookies work the same way.
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    environment: "jsdom",
  },
});
