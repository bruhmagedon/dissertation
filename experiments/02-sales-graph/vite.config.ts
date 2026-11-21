import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { benchmarkBuild } from "./employees/build-info.ts";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { "import.meta.env.VITE_LAB_BUILD": JSON.stringify(benchmarkBuild()) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
