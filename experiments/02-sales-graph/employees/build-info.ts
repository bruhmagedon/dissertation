import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

function buildHash(files: URL[]) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.pathname.split("/").at(-1)!);
    hash.update(readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
  }
  // Фиксируем версии зависимостей вместе с реализацией измеряемого кода.
  hash.update(readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
  return hash.digest("hex").slice(0, 12);
}

export function benchmarkBuild() {
  const sources = readdirSync(new URL("./", import.meta.url)).filter((item) => item.endsWith(".ts")).sort();
  return buildHash([...sources, "../timing-statistics.ts"].map((name) => new URL(name, import.meta.url)));
}

export function salesTimingBuild() {
  const sources = ["../experiment.ts", "../sales-timing.ts", "../timing-statistics.ts", "./recording.ts"];
  return buildHash(sources.map((name) => new URL(name, import.meta.url)));
}
