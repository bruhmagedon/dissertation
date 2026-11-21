import { Button } from "@/components/ui/button";
import { policyLabels, policies, engineLabels } from "../employees/engine.ts";
import type { Policy } from "../employees/engine.ts";
import { interpretation, paired, summarizeTrial } from "../employees/series.ts";
import type { Series } from "../employees/series.ts";
import { downloadJson } from "./recording-files.ts";

export const ms = (value: number) => Number.isFinite(value) ? value.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : "—";
export function dataLabel(recording: Series["recording"]) {
  return recording.data.kind === "demo" ? "3 сотрудника" : recording.data.size.toLocaleString("ru-RU") + " сотрудников · seed " + recording.data.seed;
}
export function seriesTitle(report: Series) {
  const stats = report.diagnostics.baseline;
  const summary = stats ? " · сводка " + stats.summaryReads + "/" + report.recording.steps.length : "";
  return ["Сотрудники", engineLabels[report.engine] + " " + report.version, dataLabel(report.recording), report.recording.name,
    "строки и пагинация" + summary].join(" · ");
}

export function SeriesResults({ report, onInspect }: { report: Series; onInspect: (report: Series, policy: Policy) => void }) {
  const stats = report.diagnostics.baseline;
  const steps = report.recording.steps.length;
  return <section className="lab-card lab-results">
    <div className="lab-section-head">
      <h2>Результаты серии</h2>
      <span className="lab-status">{report.status === "partial" ? "Частичная" : "Завершена"} · {report.environment.runtime === "node" ? "Node.js" : "Браузер"}</span>
    </div>
    <p className="lab-configuration">{seriesTitle(report)}</p>
    {stats && <p>Состав изменился в {stats.membershipChanges}/{steps} действий · перестановка того же состава в {stats.orderChanges}/{steps}.</p>}
    <div className="lab-table-scroll">
      <table className="lab-table results-table">
        <thead><tr><th>Политика</th><th>Эталон</th><th>Выполнения / проверки</th>
          <th>Медиана, мс</th><th>Q1–Q3, мс</th><th>База − вариант, мс</th><th>Вывод</th><th>Действия</th></tr></thead>
        <tbody>{policies.map((policy) => {
          const validation = report.diagnostics[policy];
          const timing = summarizeTrial(report, policy);
          const delta = paired(report, "baseline", policy);
          return <tr key={policy}>
            <th scope="row">{policyLabels[policy]}</th>
            <td>{validation ? validation.valid ? "Совпало" : <span className="lab-error">{validation.error}</span> : "Ожидается"}</td>
            <td>{validation ? validation.executions + " / " + validation.comparisons : "—"}</td>
            <td>{ms(timing.median)}</td>
            <td>{timing.count ? ms(timing.q1) + "–" + ms(timing.q3) : "—"}</td>
            <td>{policy === "baseline" ? "—" : <>{ms(delta.median)}
              {delta.interval && <small className="lab-subline">95% [{ms(delta.interval[0])}; {ms(delta.interval[1])}]</small>}</>}</td>
            <td>{policy === "baseline" ? timing.count + " повторов" : interpretation(report, policy)}</td>
            <td><Button size="sm" variant="outline" disabled={!validation?.valid} onClick={() => onInspect(report, policy)} aria-label={"На полотно · " + policyLabels[policy]}>На полотно</Button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="lab-footnote">Выполнения и проверки получены в диагностическом воспроизведении. Времена получены в отдельной серии на той же записи. Единица — мс на {steps} действий. Положительная разница означает экономию. Практический порог {ms(report.parameters.threshold)} мс.</p>
    <details className="lab-details">
      <summary>Паспорт и сырые времена</summary>
      <p>{report.environment.details} · {report.environment.build} · {report.created}</p>
      <p>Перебор занял {ms(report.wallMs)} мс вместе с эталоном, прогревом и подготовкой графов.</p>
      <p>Парных повторов по плану {report.parameters.repeats}, прогревов {report.parameters.warmup}, записей на политику и повтор {report.parameters.blocks}. Seed порядка {report.parameters.seed}. Интервал медианы по 2 000 бутстрэп-выборкам пар, начиная с 12 пар, seed {report.parameters.seed ^ 0x6b21}.</p>
      <div className="lab-table-scroll"><table className="lab-table">
        <thead><tr><th>Повтор</th><th>Порядок</th><th>Политика</th><th>Времена записей, мс</th></tr></thead>
        <tbody>{report.trials.map((row) => <tr key={row.pair + row.policy}>
          <td>{row.pair}</td><td>{row.order}</td><td>{policyLabels[row.policy]}</td><td>{row.timesMs.map(ms).join(" · ")}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
    <Button variant="outline" onClick={() => downloadJson("employee-series.json", report)}>Скачать серию JSON</Button>
  </section>;
}

export function EffectChart({ reports, selected }: { reports: Series[]; selected: Series }) {
  const relevant = reports.filter((report) => report.engine === selected.engine && report.version === selected.version &&
    report.environment.runtime === selected.environment.runtime && report.environment.build === selected.environment.build &&
    report.environment.details === selected.environment.details && JSON.stringify(report.parameters) === JSON.stringify(selected.parameters) &&
    (report.recording.data.kind === "demo" ? selected.recording.data.kind === "demo" :
      selected.recording.data.kind === "generated" && report.recording.data.seed === selected.recording.data.seed));
  const unique = new Map(relevant.map((report) => [
    report.recording.profile + " " + report.recording.name + " " + dataLabel(report.recording), report,
  ]));
  const rows = [...unique.values()].flatMap((report) => policies.slice(1).flatMap((policy) => {
    const estimate = paired(report, "baseline", policy);
    if (!estimate.deltas.length) return [];
    return [{ report, policy, ...estimate }];
  }));
  if (!rows.length) return null;
  const extent = Math.max(.001, ...rows.flatMap(({ q1, q3 }) => [Math.abs(q1), Math.abs(q3)]));
  const position = (value: number) => 50 + 48 * value / extent;
  return <section className="lab-card effect-chart" aria-label="График парных разниц">
    <h2>Разница с базовой политикой</h2>
    <p>Медиана и квартильный диапазон парных разниц, мс на запись</p>
    <div className="effect-scale"><div><span>−{ms(extent)}</span><span>0</span><span>+{ms(extent)}</span></div></div>
    {rows.map(({ report, policy, median, q1, q3 }) => <div className="effect-row" key={report.created + policy + report.recording.name}>
      <span>{report.recording.name} · {dataLabel(report.recording)} · {policyLabels[policy]}</span>
      <div className="effect-track" role="img" aria-label={"Медиана " + ms(median) + " мс, Q1–Q3 " + ms(q1) + "–" + ms(q3)}>
        <i className="effect-zero" /><i className="effect-range" style={{ left: position(q1) + "%", width: position(q3) - position(q1) + "%" }} />
        <i className="effect-dot" style={{ left: position(median) + "%" }} />
      </div>
      <strong>{ms(median)}</strong>
    </div>)}
  </section>;
}
