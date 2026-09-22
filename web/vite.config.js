import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API + photos to the Express server (port 4317).
// Production build is served directly by Express from web/dist.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4318,
    proxy: {
      "/api": "http://localhost:4317",
      "/whoswho": "http://localhost:4317",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
