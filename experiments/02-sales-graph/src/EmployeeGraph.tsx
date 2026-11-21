import { useRef, useState } from "react";
import type { Edge, Node as FlowNode, Viewport } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { executionDelta } from "../employees/diagnose.ts";
import { engineLabels, labels, policyLabels } from "../employees/engine.ts";
import type { Event, Frame, NodeId } from "../employees/engine.ts";
import { describeAction } from "../employees/recording.ts";
import { FlowCanvas } from "./Graph.tsx";
import type { Inspection } from "./employee-inspection.ts";

const layout: NodeId[][] = [
  ["directory", "departments", "query", "filter", "sort", "page", "pageSize", "phones"],
  ["filtered"],
  ["sorted", "pagination", "summary"],
  ["pageIds"],
  ["rows"],
];
const format = (value: unknown) => JSON.stringify(value);

function message(event: Event): string {
  switch (event.kind) {
    case "request": return "Запрос выхода · " + labels[event.node];
    case "read": return "Явное чтение · " + labels[event.node] + " #" + event.id;
    case "execute": return "Выполнена функция · " + labels[event.node];
    case "compare": return "Проверка · " + labels[event.node] + " · " + event.reason + " · просмотрено " + event.inspected;
  }
}

function graphData(inspection: Inspection, frame: Frame, base: Frame | undefined) {
  const edges: Edge[] = Object.entries(inspection.graph).flatMap(([node, deps]) => deps.map((dep) => ({
    id: dep + "-" + node, source: dep, target: node,
    style: { stroke: "var(--muted-foreground)", opacity: .65 },
  })));
  const executed = new Set(frame.evaluations.map((item) => item.node));
  const compared = new Set(frame.events.filter((event) => event.kind === "compare" && event.equal).map(({ node }) => node));
  const diff = base ? executionDelta(base, frame) : undefined;
  const nodes: FlowNode[] = layout.flatMap((row, level) => row.map((node, column) => {
    const didExecute = executed.has(node as keyof Inspection["graph"]);
    const same = compared.has(node as "summary" | "filtered" | "pageIds");
    const closed = node === "summary" && !frame.step.outputs.includes("summary");
    const status = same ? "Прежний результат" : closed ? "Не запрошено" :
      diff?.omitted.some((id) => id === node) ? "Выполнение пропущено" :
      diff?.added.some((id) => id === node) ? "Добавлено выполнение" :
      didExecute ? "Вычислилось" : "";
    return {
      id: node, position: { x: (column - (row.length - 1) / 2) * 180, y: level * 113 },
      className: "employee-node " + (didExecute ? "node-executed" : "") + (closed ? " node-closed" : ""),
      data: { label: <><strong>{labels[node]}</strong>{status && <small>{status}</small>}</> },
    };
  }));
  return { nodes, edges };
}

function eventData(events: Event[], step: number | null) {
  const readNodes = new Map<number, string>();
  const depths = new Map<string, number>();
  const edges: Edge[] = [];
  let root: string | undefined;
  const nodes: FlowNode[] = events.map((event, index) => {
    const id = String(index);
    let parent: string | undefined;
    if (event.kind === "request") root = id;
    if (event.kind === "read") {
      parent = event.parent === null ? root : readNodes.get(event.parent);
      readNodes.set(event.id, id);
    }
    if (event.kind === "execute") parent = event.within === null ? root : readNodes.get(event.within);
    if (event.kind === "compare") parent = nodesBeforeComparison(events, index, event.node);
    const depth = parent === undefined ? 0 : (depths.get(parent) ?? 0) + 1;
    depths.set(id, depth);
    if (parent !== undefined) edges.push({ id: parent + "-" + id, source: parent, target: id, hidden: step !== null && index > step });
    return {
      id, position: { x: depth * 90, y: index * 67 }, hidden: step !== null && index > step,
      className: "employee-event employee-node " + (index === step ? "node-executed" : ""),
      data: { label: message(event) },
    };
  });
  return { nodes, edges };
}
function nodesBeforeComparison(events: Event[], before: number, node: NodeId) {
  const index = events.findLastIndex((item, index) => index < before && item.kind === "execute" && item.node === node);
  return index === -1 ? undefined : String(index);
}

export function EmployeeGraph({ inspection, index, theme, onAction, onBack }: {
  inspection: Inspection; index: number; theme: "light" | "dark";
  onAction: (index: number) => void; onBack: () => void;
}) {
  const [mode, setMode] = useState<"dependencies" | "reading">("dependencies");
  const [step, setStep] = useState<number | null>(null);
  const [showBase, setShowBase] = useState(false);
  const viewport = useRef<Viewport | null>(null);
  const frame = inspection.primary[index];
  const base = inspection.compare?.[index];
  const current = showBase && base ? base : frame;
  const diff = base ? executionDelta(base, frame) : undefined;
  const data = mode === "dependencies" ? graphData(inspection, current, showBase ? undefined : base) : eventData(current.events, step);
  const total = (showBase ? inspection.compare ?? inspection.primary : inspection.primary)
    .reduce((sum, item) => sum + item.evaluations.length, 0);

  function modeChange(next: typeof mode) {
    viewport.current = null;
    setStep(null);
    setMode(next);
  }

  return <main className="lab-page employee-graph-page">
    <header className="lab-page-head">
      <div><h1>Полотно сотрудников</h1><p>{inspection.recording.name} · {engineLabels[inspection.engine]} · {policyLabels[inspection.policy]}</p></div>
      <Button variant="outline" onClick={onBack}>{inspection.back === "research" ? "К исследованию" : "К сотрудникам"}</Button>
    </header>
    <section className="lab-card employee-flow">
      <div className="lab-controls employee-flow-toolbar">
        <label>Действие<NativeSelect aria-label="Действие" value={index} onChange={(event) => { setStep(null); onAction(Number(event.target.value)); }}>
          {inspection.primary.map(({ step: item }, i) => <option value={i} key={i}>{i + 1} · {describeAction(item.action)}</option>)}
        </NativeSelect></label>
        <div className="lab-controls" role="group" aria-label="Вид полотна">
          <Button variant={mode === "dependencies" ? "default" : "outline"} aria-pressed={mode === "dependencies"} onClick={() => modeChange("dependencies")}>Зависимости</Button>
          <Button variant={mode === "reading" ? "default" : "outline"} aria-pressed={mode === "reading"} onClick={() => modeChange("reading")}>Порядок чтения</Button>
        </div>
        {base && <Button variant="outline" aria-pressed={showBase} onClick={() => { setShowBase(!showBase); setStep(null); }}>Базовая трасса</Button>}
      </div>
      <FlowCanvas key={mode} {...data} viewport={viewport} theme={theme} reading={mode === "reading"} />
      {mode === "reading" && <div className="lab-controls employee-flow-toolbar">
        <Button variant="outline" disabled={step === null} onClick={() => setStep(step !== null && step > 0 ? step - 1 : null)}>Назад</Button>
        <Button variant="outline" disabled={step === current.events.length - 1} onClick={() => setStep(step === null ? 0 : step + 1)}>Вперёд</Button>
        <Button variant="outline" onClick={() => setStep(null)}>Вся операция</Button>
        <span>{step === null ? "Все события" : message(current.events[step]) + " · " + (step + 1) + " / " + current.events.length}</span>
      </div>}
    </section>
    <section className="lab-card employee-result">
      <h2>{describeAction(current.step.action)}</h2>
      <p data-testid="employee-counts">{current.evaluations.length} выполнений за действие · {total} за прогон · {current.events.length} событий</p>
      <p>ID страницы [{current.result.rows.map(({ id }) => id).join(", ")}] · {current.result.pagination.total} строк в отборе ·
        {" "}{current.result.summary ? "Сводка: " + current.result.summary.map(([key, count]) => key + " " + count).join(", ") : "Сводка не запрошена"}</p>
      {diff && <p>Пропущено: {diff.omitted.map((node) => labels[node]).join(", ") || "нет"} · Добавилось: {diff.added.map((node) => labels[node]).join(", ") || "нет"}</p>}
      <details><summary>Значения выходов</summary><pre>{JSON.stringify(current.result, null, 2)}</pre>{base && !showBase && <><h3>Базовые значения</h3><pre>{JSON.stringify(base.result, null, 2)}</pre></>}</details>
      <details><summary>Все события действия</summary><ol>{current.events.map((event, i) => <li key={i}>
        {message(event)}{event.kind === "execute" && " · " + format(event.value)}
        {event.kind === "compare" && event.equal && " · возвращён прежний результат"}
      </li>)}</ol></details>
    </section>
  </main>;
}
