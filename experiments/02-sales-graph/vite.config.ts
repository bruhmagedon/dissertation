import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { dependencies } from "./package.json";
import { benchmarkBuild, salesTimingBuild } from "./employees/build-info.ts";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_LAB_BUILD": JSON.stringify(benchmarkBuild()),
    "import.meta.env.VITE_SALES_TIMING_BUILD": JSON.stringify(salesTimingBuild()),
    "import.meta.env.VITE_SALES_SIGNALS_VERSION": JSON.stringify(dependencies["@preact/signals-core"]),
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
