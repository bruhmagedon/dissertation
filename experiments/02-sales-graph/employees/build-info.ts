import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

export function benchmarkBuild() {
  const hash = createHash("sha256");
  for (const name of readdirSync(new URL("./", import.meta.url)).filter((item) => item.endsWith(".ts")).sort()) {
    hash.update(name);
    hash.update(readFileSync(new URL(name, import.meta.url), "utf8").replaceAll("\r\n", "\n"));
  }
  // Фиксируем версии зависимостей вместе с реализацией измеряемого кода.
  hash.update(readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
  return hash.digest("hex").slice(0, 12);
}
