import { build } from "vite";

await build({
  configFile: false,
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/server-entry.ts",
      formats: ["iife"],
      name: "VectorfallServer",
      fileName: () => "server.js",
    },
    minify: false,
    target: "es2017",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
