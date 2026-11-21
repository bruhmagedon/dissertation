import { Button } from "@/components/ui/button";
import { graphLabels, policyLabels } from "../employees/engine.ts";
import { architectureConfigs, architectureIds, assessPair, outcomeLabel, summarizeTrial } from "../employees/series.ts";
import type { ArchitectureId, ArchitectureSeries } from "../employees/series.ts";
import { downloadJson } from "./recording-files.ts";
import { ms, seriesTitle } from "./SeriesResults.tsx";

const contrasts = [
  { from: "A0", to: "A1", description: "Проверка равенства в общем отборе" },
  { from: "A0", to: "B0", description: "Изменение зависимостей" },
  { from: "B0", to: "B1", description: "Проверка равенства после изменения графа" },
  { from: "A1", to: "B0", description: "Изменение графа вместо проверки в A" },
] as const;

export function ArchitectureResults({ report, onInspect }: {
  report: ArchitectureSeries;
  onInspect: (id: ArchitectureId) => void;
}) {
  return <section className="lab-card lab-results">
    <div className="lab-section-head">
      <h2>Сравнение архитектур</h2>
      <span className="lab-status">{report.status === "partial" ? "Частичная" : "Завершена"} · {report.environment.runtime === "node" ? "Node.js" : "Браузер"}</span>
    </div>
    <p className="lab-configuration">{seriesTitle(report)}</p>
    <div className="lab-table-scroll"><table className="lab-table results-table">
      <thead><tr><th>Конфигурация</th><th>Эталон</th><th>Всего функций</th><th>Отбор</th><th>Сортировка</th><th>Сводка</th><th>Проверки равенства</th><th>Медиана, мс</th><th>Действия</th></tr></thead>
      <tbody>{architectureIds.map((id) => {
        const config = architectureConfigs[id];
        const stats = report.diagnostics[id];
        const count = (node: "filtered" | "sorted" | "summary") => stats?.byNode ? stats.byNode[node] ?? 0 : "—";
        return <tr key={id}>
          <th scope="row">{id}<small className="lab-subline">{graphLabels[config.graph]} · {policyLabels[config.policy]}</small></th>
          <td>{stats ? stats.valid ? "Совпало" : stats.error : "—"}</td>
          <td>{stats?.executions ?? "—"}</td><td>{count("filtered")}</td><td>{count("sorted")}</td><td>{count("summary")}</td>
          <td>{stats?.comparisons ?? "—"}</td><td>{ms(summarizeTrial(report, id).median)}</td>
          <td><Button size="sm" variant="outline" disabled={architectureIds.some((key) => !report.diagnostics[key]?.valid)}
            aria-label={"На полотно · " + id} onClick={() => onInspect(id)}>На полотно</Button></td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="lab-table-scroll"><table className="lab-table">
      <thead><tr><th>Разница</th><th>Медиана, мс на запись</th><th>95% интервал</th><th>Вывод</th></tr></thead>
      <tbody>{contrasts.map(({ from, to, description }) => {
        const result = assessPair(report, from, to);
        return <tr key={from + to}><th scope="row">{from} − {to}<small className="lab-subline">{description}</small></th>
          <td>{ms(result.median)}</td>
          <td>{result.interval ? "[" + result.interval.map(ms).join("; ") + "]" : "—"}</td>
          <td>{outcomeLabel(result)}{result.outcome !== "insufficient" && " · " + result.pairs + " пар"}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="lab-footnote">Все четыре конфигурации входят в один повтор. Положительная разница означает экономию. Порог {ms(report.parameters.threshold)} мс на запись из {report.recording.steps.length} действий.</p>
    <details className="lab-details"><summary>Паспорт и сырые времена</summary>
      <p>{report.environment.details} · {report.environment.build} · {report.created}</p>
      <p>Повторов {report.parameters.repeats}, прогревов {report.parameters.warmup}, воспроизведений в повторе на конфигурацию {report.parameters.blocks}, seed порядка {report.parameters.seed}.</p>
      <div className="lab-table-scroll"><table className="lab-table">
        <thead><tr><th>Повтор</th><th>Порядок</th><th>Конфигурация</th><th>Времена, мс на запись</th></tr></thead>
        <tbody>{report.trials.map((trial) => <tr key={trial.pair + trial.policy}>
          <td>{trial.pair}</td><td>{trial.order}</td><td>{trial.policy}</td><td>{trial.timesMs.map(ms).join(" · ")}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
    <Button variant="outline" onClick={() => downloadJson("employee-architectures.json", report)}>Скачать серию JSON</Button>
  </section>;
}
