import { compareOperations, formatEntry, formatValue, selectionModes, selectionSize } from "./experiment.ts";
import type { ComputedNode, Operation } from "./experiment.ts";
import { nodeLabels, operationTraces } from "./trace.ts";

export function exportComparisons(operations: readonly Operation[], sizes: readonly number[]) {
  const lines = [
    "Сравнение режимов выборки",
    `Операции: ${operations.map((operation) => operation.type === "write" ? `записать ${operation.value}` : "прочитать").join(" → ")}`,
    "Каждый размер и режим запускаются на свежем графе. Замеры времени не выполняются.",
  ];
  for (const size of sizes) {
    lines.push("", `=== ${size.toLocaleString("ru-RU")} продаж ===`);
    for (const run of compareOperations(operations, size)) {
      const traces = operationTraces(run.snapshot.log);
      const reads = traces.filter((trace) => trace.operation.type === "read");
      const lastRead = reads.at(-1);
      lines.push(
        "",
        selectionModes.find((mode) => mode.id === run.mode)!.label,
        `Результаты чтений: ${run.snapshot.readings.map(formatValue).join(" → ") || "чтений нет"}`,
        `Строк в выборке после каждого чтения: ${reads.map((trace) => selectionSize(trace.after.values.filtered) ?? 0).join(" → ") || "чтений нет"}`,
        "Узел | Всего вычислений | Прирост на последнем чтении",
      );
      for (const node of ["filtered", "sum", "count", "average"] as ComputedNode[]) {
        const delta = lastRead ? lastRead.after.calls[node] - lastRead.before.calls[node] : 0;
        lines.push(`${nodeLabels[node]} (${node}) | ${run.snapshot.calls[node]} | +${delta}`);
      }
      lines.push("", "Операции и приросты:");
      for (const trace of traces) {
        const delta = (["filtered", "sum", "count", "average"] as ComputedNode[]).map((node) => `${node}: +${trace.after.calls[node] - trace.before.calls[node]}`).join(", ");
        lines.push(`${trace.index + 1}. ${trace.operation.type === "write" ? `Записать ${trace.after.threshold}` : `Прочитать среднее = ${formatValue(trace.after.readings.at(-1))}`} | ${delta}`);
      }
      lines.push("", "Полный журнал:", ...run.snapshot.log.map(formatEntry));
    }
  }
  return lines.join("\n") + "\n";
}
