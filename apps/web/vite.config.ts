import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin for the session cookie: the browser talks to Vite, Vite forwards /api.
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  preview: {
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  build: {
    // The parity test page embeds every golden vector (about 0.7 MB); the app itself is far smaller.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: { main: "index.html", parity: "parity.html" },
    },
  },
});
