import { useRef, useState } from "react";
import { MarkerType } from "@xyflow/react";
import type { Edge, Node as FlowNode, Viewport } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Select, SelectItem } from "@/components/ui/select";
import { executionDelta } from "../employees/diagnose.ts";
import { engineLabels, graphLabels, labels, policyLabels } from "../employees/engine.ts";
import type { DependencyGraph, Event, Frame, Node, NodeId } from "../employees/engine.ts";
import { FlowCanvas } from "./Graph.tsx";
import { inspectArchitectures, inspectionTitle } from "./employee-inspection.ts";
import type { Inspection } from "./employee-inspection.ts";
import { actionTitle, outputDetails, outputStatus, plainEvent, plainLabels, screenOutputs } from "./employee-explanation.ts";

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

function graphData(graph: DependencyGraph, frame: Frame, base: Frame | undefined) {
  const edges: Edge[] = Object.entries(graph).flatMap(([node, deps]) => deps.map((dep) => ({
    id: dep + "-" + node, source: dep, target: node,
    style: { stroke: "var(--muted-foreground)", opacity: .65 },
  })));
  const executed = new Set(frame.evaluations.map((item) => item.node));
  const compared = new Set(frame.events.filter((event) => event.kind === "compare" && event.equal).map(({ node }) => node));
  const diff = base ? executionDelta(base, frame) : undefined;
  const levels = graph.activeDepartments ? [layout[0], ["activeDepartments"] as NodeId[], ...layout.slice(1)] : layout;
  const nodes: FlowNode[] = levels.flatMap((row, level) => row.map((node, column) => {
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

function focusedGraph(graph: DependencyGraph, frame: Frame, previous: Frame | undefined, history: readonly Frame[]) {
  const executed = new Map(frame.events.flatMap((event) => event.kind === "execute" ? [[event.node, event.value] as const] : []));
  const lastValues = new Map<Node, unknown>();
  for (const item of history) {
    for (const event of item.events) if (event.kind === "execute") lastValues.set(event.node, event.value);
  }
  const changedInputs = new Set(frame.evaluations.flatMap(({ changed }) => changed));
  const actual = frame.events.flatMap((event) => event.kind === "read" && event.from !== "screen" &&
    (Object.hasOwn(graph, event.node) || changedInputs.has(event.node))
    ? [{ source: event.node, target: event.from }] : []);
  const seen = new Set<NodeId>([
    ...executed.keys(), ...frame.step.outputs, ...actual.flatMap(({ source, target }) => [source, target]),
  ]);
  const inputsChecked = new Set(actual.map(({ source, target }) => source + "-" + target));
  const stable = new Set<Node>(frame.events.flatMap((event) => event.kind === "compare" && event.equal ? [event.node] : []));
  if (executed.get("activeDepartments") === null && lastValues.get("activeDepartments") === null) stable.add("activeDepartments");
  const needed = new Set<NodeId>(frame.step.outputs);
  for (const node of needed) for (const dependency of graph[node as Node] ?? []) needed.add(dependency);
  const stops = Object.entries(graph).flatMap(([id, dependencies]) => {
    const target = id as Node;
    if (executed.has(target)) return [];
    return dependencies.flatMap((source) => executed.has(source as Node) && !inputsChecked.has(source + "-" + target) &&
      (seen.has(target) || (stable.has(source as Node) && needed.has(target)))
      ? [{ source, target, stopped: true }] : []);
  });
  for (const { target } of stops) seen.add(target);
  const connections = [...actual.map((edge) => ({ ...edge, stopped: false })), ...stops];
  const openingSummary = frame.step.action.type === "summary" && frame.step.action.open;
  if (openingSummary) {
    seen.clear();
    seen.add("summary");
    // Следуем только к данным, которые понадобились открытой сводке.
    for (let size = 0; size !== seen.size;) {
      size = seen.size;
      for (const edge of connections) if (seen.has(edge.target)) seen.add(edge.source);
    }
  }

  function status(node: NodeId) {
    const output = screenOutputs.find((item) => item === node);
    if (output) return outputStatus(frame, previous, output);
    if (!Object.hasOwn(graph, node)) return "Прочитали данные";
    if (!executed.has(node as Node)) return frame.events.some((event) => event.kind === "read" && event.node === node)
      ? "Взяли готовое" : "Вычисление пропустили";
    const equality = frame.events.find((event) => event.kind === "compare" && event.node === node);
    if (equality?.kind === "compare") return equality.equal ? "Пересчитали, результат прежний" : "Пересчитали, результат изменился";
    const old = lastValues.get(node as Node);
    const value = executed.get(node as Node);
    // Сокращённые значения из журнала не доказывают равенство полных списков.
    if (old !== undefined && (old === null || value === null || (Array.isArray(old) && Array.isArray(value)))) {
      return differenceValue(old, value) ? "Пересчитали, результат изменился" : "Пересчитали, результат прежний";
    }
    return "Пересчитали";
  }

  function valueLabel(node: NodeId) {
    const result = screenOutputs.find((item) => item === node);
    if (result) return outputDetails(frame, previous, result);
    const value = executed.has(node as Node) ? executed.get(node as Node) : lastValues.get(node as Node);
    if (node === "activeDepartments" && value === null) return "Все отделы, отдельный список не нужен";
    if (node === "departments" && frame.step.action.type === "department") return `Новый отдел · ${frame.step.action.department}`;
    if (Array.isArray(value)) return `Сотрудников · ${value.length}`;
    if (value && typeof value === "object") {
      if ("length" in value) return `Сотрудников · ${value.length}`;
      if ("entries" in value) return `Сотрудников · ${value.entries}`;
    }
  }

  const levels: NodeId[][] = openingSummary && seen.size <= 3
    ? [[...seen].filter((node) => node !== "summary"), ["summary"]]
    : [layout[0], ["activeDepartments"], ...layout.slice(1)]
      .map((level) => (level as NodeId[]).filter((node) => seen.has(node))).filter((level) => level.length);
  const nodes: FlowNode[] = levels.flatMap((row, level) => row.map((node, column) => ({
    id: node, position: { x: (column - (row.length - 1) / 2) * 226, y: level * 133 },
    className: "employee-node employee-focus-node " + (executed.has(node as Node) ? "node-executed" : ""),
    data: { label: <><strong>{plainLabels[node]}</strong><small>{status(node)}</small>{valueLabel(node) && <span>{valueLabel(node)}</span>}</> },
  })));
  const edges: Edge[] = [...new Map(connections.filter(({ source, target }) => seen.has(source) && seen.has(target))
    .map(({ source, target, stopped }): [string, Edge] => {
      const changed = frame.evaluations.some((item) => item.node === target && item.changed.includes(source));
      const id = source + "-" + target;
      const color = changed ? "var(--primary)" : "var(--muted-foreground)";
      return [id, { id, source, target, markerEnd: { type: MarkerType.ArrowClosed, color }, style: {
        stroke: color, strokeWidth: changed ? 2 : 1, strokeDasharray: stopped ? "5 5" : undefined,
      } }];
    })).values()];
  return { nodes, edges };
}

function differenceValue(previous: unknown, next: unknown) {
  return format(previous) !== format(next);
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
      id, position: { x: depth * 90, y: index * 78 }, hidden: step !== null && index > step,
      className: "employee-event employee-node " + (index === step ? "node-executed" : ""),
      data: { label: plainEvent(event) },
    };
  });
  return { nodes, edges };
}
function nodesBeforeComparison(events: Event[], before: number, node: NodeId) {
  const index = events.findLastIndex((item, index) => index < before && item.kind === "execute" && item.node === node);
  return index === -1 ? undefined : String(index);
}

export function EmployeeGraph({ inspection, index, theme, onAction, onBack, onInspect, onResearch }: {
  inspection: Inspection; index: number; theme: "light" | "dark";
  onAction: (index: number) => void; onBack: () => void;
  onInspect: (item: Inspection) => void;
  onResearch: (recording: Inspection["recording"], index: number) => void;
}) {
  const [mode, setMode] = useState<"focus" | "dependencies" | "reading">("focus");
  const [error, setError] = useState("");
  const [step, setStep] = useState<number | null>(null);
  const [showBase, setShowBase] = useState(false);
  const [traceIndex, setTraceIndex] = useState(0);
  const traces = [inspection, ...(inspection.alternatives ?? [])];
  const active = traces[traceIndex] ?? inspection;
  const viewport = useRef<Viewport | null>(null);
  const frame = active.primary[index];
  const reference = traces.find(({ title }) => title === "A0") ?? inspection;
  const base = inspection.compare?.[index] ?? (active !== reference ? reference.primary[index] : undefined);
  const current = showBase && base ? base : frame;
  const diff = base ? executionDelta(base, frame) : undefined;
  const currentFrames = showBase ? inspection.compare ?? active.primary : active.primary;
  const previous = index ? currentFrames[index - 1] : showBase ? inspection.baseInitial ?? active.initial : active.initial;
  const history = [...(showBase ? inspection.baseInitial ? [inspection.baseInitial] : [] : active.initial ? [active.initial] : []), ...currentFrames.slice(0, index)];
  const data = mode === "focus" ? focusedGraph(active.graph, current, previous, history) : mode === "dependencies"
    ? graphData(active.graph, current, showBase ? undefined : base) : eventData(current.events, step);
  const total = currentFrames.reduce((sum, item) => sum + item.evaluations.length, 0);
  const title = actionTitle(current, previous);

  function compareAction() {
    try {
      onInspect(inspectArchitectures(inspection.recording, inspection.engine, ["A0", "A1", "B0"], inspection.back, index));
    } catch (issue) {
      setError((issue as Error).message);
    }
  }

  function modeChange(next: typeof mode) {
    viewport.current = null;
    setStep(null);
    setMode(next);
  }

  return <main className="lab-page employee-graph-page">
    <header className="lab-page-head">
      <div><h1>Полотно сотрудников</h1><p>{inspection.recording.name} · {engineLabels[inspection.engine]} · граф {active.variant ?? "A"} · {graphLabels[active.variant ?? "A"]} · {policyLabels[showBase ? "baseline" : active.policy]}</p></div>
      <Button variant="outline" onClick={onBack}>{inspection.back === "research" ? "К исследованию" : "К сотрудникам"}</Button>
    </header>
    <section className="lab-card employee-action" aria-labelledby="current-action">
      <div className="lab-section-head">
        <h2 id="current-action">{title}</h2>
        <label className="series-picker">Действие<Select aria-label="Действие" value={String(index)} onValueChange={(value) => {
          viewport.current = null; setStep(null); onAction(Number(value));
        }}>
          {active.primary.map((item, i) => <SelectItem value={String(i)} key={i}>{i + 1} · {actionTitle(item, active.primary[i - 1] ?? active.initial)}</SelectItem>)}
        </Select></label>
      </div>
      <div className="employee-output-cards">
        {screenOutputs.map((output) => <article key={output} aria-label={plainLabels[output]}>
          <h3>{plainLabels[output]}</h3>
          <strong>{outputStatus(current, previous, output)}</strong>
          <p>{outputDetails(current, previous, output)}</p>
        </article>)}
      </div>
      <div className="lab-controls">
        {traces.length === 1 && inspection.back === "employees" && <Button variant="outline" onClick={compareAction}>Сравнить варианты этого действия</Button>}
        {inspection.back === "employees" && <Button variant="outline" onClick={() => onResearch(inspection.recording, index)}>Замерить запись в исследовании</Button>}
      </div>
      {error && <p role="alert" className="lab-error">{error}</p>}
    </section>
    {traces.length > 1 && <section className="lab-card employee-trace-comparison">
      <div className="lab-section-head">
        <h2>Исполнения действия {index + 1}</h2>
        <div className="lab-controls" role="group" aria-label="Исполнение действия">
          {traces.map((trace, position) => <Button key={trace.title} variant={position === traceIndex ? "default" : "outline"}
            aria-pressed={position === traceIndex} onClick={() => {
              viewport.current = null; setStep(null); setShowBase(false); setTraceIndex(position);
            }}>{inspectionTitle(trace.title ?? "")}</Button>)}
        </div>
      </div>
      <p>{explainVariant(active.title, frame)}</p>
      {diff && <p>{diff.omitted.length ? "Пропустили вычисления: " + diff.omitted.map((node) => plainLabels[node]).join(", ") + ". " : ""}
        {diff.added.length ? "Дополнительно посчитали: " + diff.added.map((node) => plainLabels[node]).join(", ") + ". " : ""}
        {!diff.omitted.length && !diff.added.length && "Набор выполненных функций совпал. "}
        Сравнение с {inspectionTitle(reference.title ?? "базовым вариантом")}.</p>}
      <details className="lab-details"><summary>Подробная таблица выполнений</summary>
      <div className="lab-table-scroll"><table className="lab-table results-table">
        <thead><tr><th>Исполнение</th><th>Запрошено</th><th>Отбор</th><th>Сортировка</th><th>Сравнение ID отбора</th><th>Сводка</th></tr></thead>
        <tbody>{traces.map((trace) => {
          const frame = trace.primary[index];
          const executed = (node: NodeId) => frame.evaluations.some((entry) => entry.node === node);
          const comparison = frame.events.find((event) => event.kind === "compare" && event.node === "filtered");
          return <tr key={trace.title}>
            <th scope="row">{trace.title}</th>
            <td>{frame.events.flatMap((event) => event.kind === "request" ? [labels[event.node]] : []).join(", ")}</td>
            <td>{executed("filtered") ? "Выполнился" : "Пропущен"}</td>
            <td>{executed("sorted") ? "Выполнилась" : "Пропущена"}</td>
            <td>{comparison?.kind === "compare" ? comparison.equal ? "Прежний результат" : "Результат изменился" : "Не выполнялось"}</td>
            <td>{!frame.step.outputs.includes("summary") ? "Не запрошена" : executed("summary") ? "Пересчитана" : "Из кеша"}
              {frame.result.summary && <small className="lab-subline">
                {frame.result.summary.map(([department, count]) => department + " " + count).join(", ") || "Пустая"}
              </small>}
            </td>
          </tr>;
        })}</tbody>
      </table></div></details>
    </section>}
    <section className="lab-card employee-flow">
      <div className="lab-controls employee-flow-toolbar">
        <div className="lab-controls" role="group" aria-label="Вид полотна">
          <Button variant={mode === "focus" ? "default" : "outline"} aria-pressed={mode === "focus"} onClick={() => modeChange("focus")}>Что понадобилось</Button>
          <Button variant={mode === "dependencies" ? "default" : "outline"} aria-pressed={mode === "dependencies"} onClick={() => modeChange("dependencies")}>Зависимости</Button>
          <Button variant={mode === "reading" ? "default" : "outline"} aria-pressed={mode === "reading"} onClick={() => modeChange("reading")}>Порядок чтения</Button>
        </div>
        {inspection.compare && <Button variant="outline" aria-pressed={showBase} onClick={() => { setShowBase(!showBase); setStep(null); }}>Базовая трасса</Button>}
      </div>
      {mode === "focus" && <p className="employee-flow-caption">На схеме видны прочитанные результаты и входы, изменившиеся для вычислений. Пунктир показывает, где дальше взяли готовый результат.</p>}
      <FlowCanvas key={mode + "-" + traceIndex + "-" + index + "-" + showBase} {...data} viewport={viewport} theme={theme} reading={mode === "reading"} />
      {mode === "reading" && <div className="lab-controls employee-flow-toolbar">
        <Button variant="outline" disabled={step === null} onClick={() => setStep(step !== null && step > 0 ? step - 1 : null)}>Назад</Button>
        <Button variant="outline" disabled={step === current.events.length - 1} onClick={() => setStep(step === null ? 0 : step + 1)}>Вперёд</Button>
        <Button variant="outline" onClick={() => setStep(null)}>Вся операция</Button>
        <span>{step === null ? "Все события" : plainEvent(current.events[step]) + " · " + (step + 1) + " / " + current.events.length}</span>
      </div>}
      {mode === "reading" && step !== null && <details key={step} className="employee-flow-toolbar employee-step-details">
        <summary>Технические данные шага</summary>
        <p>{message(current.events[step])}</p>
        <pre>{JSON.stringify(current.events[step], null, 2)}</pre>
      </details>}
    </section>
    <section className="lab-card employee-result">
      <h2>Подробности действия</h2>
      <p data-testid="employee-counts">{current.evaluations.length} выполнений за действие · {total} за прогон · {current.events.length} событий</p>
      <p>ID страницы [{current.result.rows.map(({ id }) => id).join(", ")}] · {current.result.pagination.total} строк в отборе ·
        {" "}{current.result.summary ? "Сводка: " + current.result.summary.map(([key, count]) => key + " " + count).join(", ") : "Сводка не запрошена"}</p>
      {current.step.action.type === "department" && (() => {
        const { id } = current.step.action;
        const row = current.result.rows.find((employee) => employee.id === id);
        return <p>{row ? row.name + " #" + id + " · " + row.department : "Сотрудник #" + id + " отсутствует на странице"}</p>;
      })()}
      {diff && <p>Пропущено: {diff.omitted.map((node) => labels[node]).join(", ") || "нет"} · Добавилось: {diff.added.map((node) => labels[node]).join(", ") || "нет"}</p>}
      <details><summary>Значения выходов</summary><pre>{JSON.stringify(current.result, null, 2)}</pre>{base && !showBase && <><h3>Базовые значения</h3><pre>{JSON.stringify(base.result, null, 2)}</pre></>}</details>
      <details><summary>Все события действия</summary><ol>{current.events.map((event, i) => <li key={i}>
        {plainEvent(event)}<details><summary>Технические данные</summary>{message(event)}{event.kind === "execute" && " · " + format(event.value)}
        {event.kind === "compare" && event.equal && " · возвращён прежний результат"}<pre>{JSON.stringify(event, null, 2)}</pre></details>
      </li>)}</ol></details>
    </section>
  </main>;
}


function explainVariant(title: string | undefined, frame: Frame) {
  const didFilter = frame.evaluations.some(({ node }) => node === "filtered");
  const comparison = frame.events.find((event) => event.kind === "compare" && event.node === "filtered");
  const departmentInput = frame.events.find((event) => event.kind === "execute" && event.node === "activeDepartments");
  if (comparison?.kind === "compare") {
    if (!comparison.equal) return "Отбор выполнился. Проверка обнаружила другой список сотрудников и передала его дальше.";
    return "Отбор выполнился. Проверка подтвердила, что список сотрудников прежний. Дальше передали готовый список.";
  }
  if ((title === "B0" || title === "B1") && departmentInput?.kind === "execute") {
    if (departmentInput.value === null && !didFilter) return "При «Все отделы» отбору не нужны данные об отделах. Отбор взяли готовым. Строки и открытая сводка получают отделы напрямую.";
    if (didFilter) return "Фильтр по отделу активен. Отбор проверил, кто теперь подходит под фильтр.";
  }
  if (title === "A0" && didFilter && frame.step.action.type === "department") {
    return "Общий отбор зависит от отделов. После перевода он заново определил, кто подходит под условия.";
  }
  return didFilter ? "Отбор заново определил, кто подходит под условия." : "Отбор в этом действии не выполнялся.";
}
