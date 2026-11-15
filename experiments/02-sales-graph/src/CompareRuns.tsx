import { ArrowUpRight, Columns2, Download, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { selectionModes, selectionSize } from "../experiment.ts";
import type { ComputedNode, Operation, SelectionMode, Snapshot } from "../experiment.ts";
import { computationCount, nodeLabels, operationTraces } from "../trace.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDisplayValue as formatValue } from "./formatForDisplay.ts";
import { exportComparisons } from "../comparison-export.ts";
import { Hint } from "@/components/ui/tooltip";

export type SavedRun = { mode: SelectionMode; snapshot: Snapshot };

export function CompareRuns({ open, onOpenChange, runs, onSelect, sizeDraft, onSizeChange, onRun, operations }: {
  sizeDraft: string;
  onSizeChange: (value: string) => void;
  onRun: (count: number) => void;
  operations: Operation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: SavedRun[];
  onSelect: (run: SavedRun, operation: number) => void;
}) {
  const count = Number(sizeDraft);
  const validCount = /^\d+$/.test(sizeDraft) && Number.isInteger(count) && count >= 2 && count <= 100_000;
  const comparison = runs.map((run) => {
    const traces = operationTraces(run.snapshot.log);
    const lastRead = traces.findLast((trace) => trace.operation.type === "read");
    const delta = Object.fromEntries(
      (["filtered", "sum", "count", "average"] as ComputedNode[]).map((node) => [node, lastRead ? lastRead.after.calls[node] - lastRead.before.calls[node] : 0]),
    ) as Record<ComputedNode, number>;
    return { run, traces, delta, total: Object.values(delta).reduce((sum, count) => sum + count, 0) };
  });
  const normal = comparison.find(({ run }) => run.mode === "normal");
  const reused = comparison.find(({ run }) => run.mode === "reuse-array");
  const source = runs[0]?.snapshot;
  const readingCount = source?.readings.length ?? 0;
  const readingLabel = readingCount === 1 ? "На первом чтении" : readingCount === 2 ? "На втором чтении" : `На чтении №${readingCount}`;
  const savedOperations = source?.log.filter((event) => event.type === "write" || event.type === "read") ?? [];
  const exportOperations = source ? savedOperations : operations;
  function downloadComparison() {
    if (!exportOperations.length) return;
    const sizes = [4, 1_000, 10_000, 100_000];
    const customSize = validCount ? count : source?.salesCount;
    if (customSize && !sizes.includes(customSize)) sizes.push(customSize);
    sizes.sort((a, b) => a - b);
    const text = exportComparisons(exportOperations, sizes);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "reactivity-comparison-all-sizes.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const scenario = savedOperations.map((event) => event.type === "write" ? `записать ${event.value}` : "прочитать").join(" → ");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild><Button size="sm" variant="outline"><Columns2 aria-hidden="true" />Сравнить прогоны</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="comparison-overlay" />
        <Dialog.Content className="comparison-screen" onCloseAutoFocus={(event) => event.preventDefault()}>
          <header className="comparison-header">
            <div>
              <Dialog.Title>Сравнить прогоны</Dialog.Title>
              <Dialog.Description>Повторите операции текущего прогона на одинаковых наборах в двух режимах.</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button size="icon-sm" variant="ghost" aria-label="Закрыть сравнение"><X aria-hidden="true" /></Button></Dialog.Close>
          </header>
          <form className="comparison-settings" onSubmit={(event) => { event.preventDefault(); if (validCount && operations.length) onRun(count); }}>
            <fieldset>
              <legend>Количество продаж</legend>
              <div className="comparison-size-options">
                {[4, 1_000, 10_000, 100_000].map((size) => <Button key={size} type="button" size="sm" variant={validCount && count === size ? "default" : "outline"} aria-pressed={validCount && count === size} onClick={() => onSizeChange(String(size))}>{size.toLocaleString("ru-RU")}</Button>)}
                <label htmlFor="comparison-size">Своё число</label>
                <Input id="comparison-size" className="w-[130px]! flex-none" type="number" min={2} max={100_000} step={1} value={sizeDraft} onChange={(event) => onSizeChange(event.target.value)} aria-invalid={!validCount} aria-describedby="comparison-size-help" />
                <Button type="submit" size="sm" disabled={!validCount || operations.length === 0}>Запустить сравнение</Button>
                <Hint text="Скачать TXT: показанный сценарий на 4, 1 000, 10 000, 100 000 продажах и своём размере">
                  <span><Button type="button" size="sm" variant="outline" disabled={!exportOperations.length} onClick={downloadComparison}><Download aria-hidden="true" />Экспорт всех размеров</Button></span>
                </Hint>
              </div>
              <p id="comparison-size-help" className="comparison-settings-help">{!validCount ? "Введите целое число от 2 до 100 000." : "Размер применяется только при запуске. Изменение поля не меняет показанные результаты."}</p>
            </fieldset>
            <p className="comparison-settings-help">{operations.length ? `Будут повторены: ${operations.map((event) => event.type === "write" ? `записать ${event.value}` : "прочитать").join(" → ")}` : "Сначала выполните записи и чтения на полотне."}</p>
          </form>
          {source && <p className="comparison-dataset"><strong>{source.salesCount.toLocaleString("ru-RU")} продаж</strong> · в выборке {operationTraces(source.log).filter((trace) => trace.operation.type === "read").slice(-2).map((trace) => (selectionSize(trace.after.values.filtered) ?? 0).toLocaleString("ru-RU")).join(" → ") || "чтений ещё нет"}<span>Показанные результаты: {scenario}</span></p>}
          {normal && reused && readingCount > 0 && <p className="comparison-saving">{readingLabel}: <strong>{normal.total} → {computationCount(reused.total)}</strong></p>}
          <div className="comparison-columns">
            {comparison.map(({ run, traces, delta, total }) => {
              return (
                <section className="comparison-run" key={run.mode} aria-labelledby={`compare-${run.mode}`}>
                  <h2 id={`compare-${run.mode}`}>{selectionModes.find((mode) => mode.id === run.mode)?.label}</h2>
                  <p className="comparison-run-size">{run.snapshot.salesCount.toLocaleString("ru-RU")} продаж · в выборке {traces.filter((trace) => trace.operation.type === "read").slice(-2).map((trace) => (selectionSize(trace.after.values.filtered) ?? 0).toLocaleString("ru-RU")).join(" → ") || "чтений ещё нет"}</p>
                  <div className="comparison-reading-summary">
                    <p className="comparison-readings">{run.snapshot.readings.map(formatValue).join(" → ") || "Чтений ещё нет"}</p>
                    {readingCount > 0 && <span>{readingLabel}: <strong>{computationCount(total)}</strong></span>}
                  </div>
                  <table className="comparison-table">
                    <caption>Фактические выполнения computed</caption>
                    <thead><tr><th scope="col">Узел</th><th scope="col">Всего</th><th scope="col">{readingCount > 0 ? readingLabel : "Прирост чтения"}</th></tr></thead>
                    <tbody>{(["filtered", "sum", "count", "average"] as ComputedNode[]).map((node) => (
                      <tr key={node} className={normal && reused && normal.delta[node] !== reused.delta[node] ? "comparison-difference" : undefined}><th scope="row">{nodeLabels[node]} <small>{node}</small></th><td>{run.snapshot.calls[node]}</td><td>{readingCount > 0 ? `+${delta[node]}` : "—"}</td></tr>
                    ))}</tbody>
                  </table>
                  <h3>Открыть операцию на полотне</h3>
                  <ol className="comparison-operations">
                    {traces.map((trace) => {
                      const executions = Object.values(trace.after.calls).reduce((total, count) => total + count, 0) - Object.values(trace.before.calls).reduce((total, count) => total + count, 0);
                      return <li key={trace.start}><button type="button" onClick={() => onSelect(run, trace.start)}>
                        <span><strong>{trace.index + 1}. {trace.operation.type === "write" ? `Записать ${trace.after.threshold}` : `Прочитать среднее · ${formatValue(trace.after.readings.at(-1))}`}</strong><small>{computationCount(executions)}</small></span>
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </button></li>;
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
          <p className="comparison-note">Выбор операции откроет её целиком в режиме «Порядок чтения» вместе с сохранённым журналом выбранного прогона.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
