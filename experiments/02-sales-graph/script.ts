import { deepStrictEqual } from "node:assert/strict";
import { formatEntry, runScenario } from "./experiment.ts";

const results = { A: runScenario("A").snapshot(), B: runScenario("B").snapshot() };
// Проверяем сохранённые числа, не читаем граф повторно.
deepStrictEqual(results.A.readings, [25, 30, 35, 35]);
deepStrictEqual(results.B.readings, [25, 35, 35]);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results));
} else {
  for (const name of ["A", "B"] as const) {
    console.log(`\nСценарий ${name}`);
    for (const entry of results[name].log) console.log(formatEntry(entry));
  }
  console.log("\nПроверки результатов A и B пройдены.");
  console.table({ A: results.A.calls, B: results.B.calls });
}
