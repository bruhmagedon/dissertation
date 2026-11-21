import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { transferPair } from "../employees/conditions.ts";
import type { Condition } from "../employees/conditions.ts";
import { diagnose } from "../employees/diagnose.ts";
import { engineLabels, graphLabels, labels } from "../employees/engine.ts";
import type { Engine, GraphVariant } from "../employees/engine.ts";
import { departments } from "../employees/recording.ts";
import type { Data, Department, Recording } from "../employees/recording.ts";
import type { Inspection, InspectionTrace } from "./employee-inspection.ts";

export function TransferConditions({ data, engine, graph, onInspect }: {
  data: () => Data; engine: Engine; graph: GraphVariant; onInspect: (item: Inspection) => void;
}) {
  const [kind, setKind] = useState<Condition>("summary");
  const [filter, setFilter] = useState<Department | "">("");
  const [summary, setSummary] = useState(true);
  const [result, setResult] = useState<{
    engine: Engine;
    graph: GraphVariant;
    left: Recording;
    traces: InspectionTrace[];
    difference: number;
  }>();
  const [error, setError] = useState("");
  function run() {
    try {
      const pair = transferPair(data(), kind, { summary, filter });
      const traces = pair.map((recording): InspectionTrace => {
        const diagnostic = diagnose(recording, engine, "baseline", { graph });
        if (!diagnostic.stats.valid) throw new Error(diagnostic.stats.error);
        return { graph: diagnostic.graph, variant: graph, policy: "baseline", primary: diagnostic.frames, title: recording.name };
      });
      const key = (frame: InspectionTrace["primary"][number]) =>
        JSON.stringify(frame.events.map(({ kind, node }) => [kind, node]));
      const difference = traces[0].primary.findIndex((frame, index) => key(frame) !== key(traces[1].primary[index]));
      setResult({ engine, graph, left: pair[0], traces, difference });
      setError("");
    } catch (issue) { setError((issue as Error).message); setResult(undefined); }
  }
  return <section className="lab-card">
    <h2>Одни переводы, разные условия</h2>
    <p>Две записи сохраняют исходный набор, порядок переводов, ID и целевые отделы.</p>
    <div className="lab-controls">
      <label>Что меняется<NativeSelect aria-label="Что меняется" value={kind} onChange={(event) => setKind(event.target.value as Condition)}>
        <option value="summary">Доступность сводки</option><option value="filter">Фильтр по отделу</option>
      </NativeSelect></label>
      {kind === "summary" ? <label>Фиксированный фильтр<NativeSelect aria-label="Фиксированный фильтр" value={filter}
        onChange={(event) => setFilter(event.target.value as typeof filter)}>
        <option value="">Все отделы</option>{departments.map((item) => <option key={item}>{item}</option>)}
      </NativeSelect></label> : <label className="lab-checkbox"><input type="checkbox" checked={summary} onChange={(event) => setSummary(event.target.checked)} /> Сводка открыта в обеих записях</label>}
      <Button variant="outline" onClick={run}>Сопоставить условия</Button>
    </div>
    {error && <p role="alert" className="lab-error">{error}</p>}
    {result && <>
      <p>{engineLabels[result.engine]} · {result.graph} · {graphLabels[result.graph]} · {result.left.steps.length} переводов</p>
      <div className="lab-table-scroll"><table className="lab-table">
        <thead><tr><th>Условие</th><th>Запрошенные выходы</th><th>Отбор</th><th>Сортировка</th><th>Строки</th><th>Сводка</th></tr></thead>
        <tbody>{result.traces.map((trace) => <tr key={trace.title}>
          <th scope="row">{trace.title}</th><td>{trace.primary[0].step.outputs.map((output) => labels[output]).join(", ")}</td>
          {(["filtered", "sorted", "rows", "summary"] as const).map((node) => <td key={node}>
            {trace.primary.flatMap(({ evaluations }) => evaluations).filter((entry) => entry.node === node).length}
          </td>)}
        </tr>)}</tbody>
      </table></div>
      <p>{result.difference < 0 ? "По записанным событиям трассы совпали." : "Первое различие трасс на действии " + (result.difference + 1) + "."}</p>
      <Button variant="outline" onClick={() => {
        const [left, right] = result.traces;
        onInspect({ ...left, recording: result.left, engine: result.engine, alternatives: [right],
          action: Math.max(0, result.difference), back: "research" });
      }}>Открыть обе трассы</Button>
    </>}
  </section>;
}
