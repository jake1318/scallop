import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      process: "process/browser",
      buffer: "buffer/", // <--- UNCOMMENT THIS LINE!
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
        "process.env": "{}",
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          process: true,
          buffer: true, // <--- UNCOMMENT THIS LINE!
        }),
        NodeModulesPolyfillPlugin(),
      ],
    },
  },
});
