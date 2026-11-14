import { ArrowUpRight, Columns2, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { formatValue, selectionModes } from "../experiment.ts";
import type { ComputedNode, SelectionMode, Snapshot } from "../experiment.ts";
import { computationCount, nodeLabels, operationTraces } from "../trace.ts";
import { Button } from "@/components/ui/button";

export type SavedRun = { mode: SelectionMode; snapshot: Snapshot };

export function CompareRuns({ open, onOpenChange, runs, onSelect }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: SavedRun[];
  onSelect: (run: SavedRun, operation: number) => void;
}) {
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
  const operations = source?.log.filter((event) => event.type === "write" || event.type === "read") ?? [];
  const scenario = operations.map((event) => event.type === "write" ? `записать ${event.value}` : "прочитать").join(" → ");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild><Button size="sm" variant="outline"><Columns2 aria-hidden="true" />Сравнить прогоны</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="comparison-overlay" />
        <Dialog.Content className="comparison-screen" onCloseAutoFocus={(event) => event.preventDefault()}>
          <header className="comparison-header">
            <div>
              <Dialog.Title>Сравнить прогоны</Dialog.Title>
              <Dialog.Description>{scenario ? `Ваши операции: ${scenario}. Повторены на свежем графе в каждом режиме.` : "Сначала запишите порог или прочитайте среднее на полотне, затем откройте сравнение."}</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button size="icon-sm" variant="ghost" aria-label="Закрыть сравнение"><X aria-hidden="true" /></Button></Dialog.Close>
          </header>
          {normal && reused && readingCount > 0 && <p className="comparison-saving">{readingLabel}: <strong>{normal.total} → {computationCount(reused.total)}</strong></p>}
          <div className="comparison-columns">
            {comparison.map(({ run, traces, delta, total }) => {
              return (
                <section className="comparison-run" key={run.mode} aria-labelledby={`compare-${run.mode}`}>
                  <h2 id={`compare-${run.mode}`}>{selectionModes.find((mode) => mode.id === run.mode)?.label}</h2>
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
