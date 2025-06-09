// vite.config.ts

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "process";

export default defineConfig({
  plugins: [react()],
  define: {
    // Polyfill process.env.NODE_ENV and process.env for libraries that reference process.env
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
    "process.env": {},
  },
  resolve: {
    alias: {
      // Alias `process` imports to the browser polyfill
      process: "process/browser",
      "@": "/src",
    },
  },
  server: {
    open: true,
  },
});
