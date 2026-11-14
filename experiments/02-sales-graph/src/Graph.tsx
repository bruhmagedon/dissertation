import { useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { ListTree, Network } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
} from "@xyflow/react";
import type { Edge, EdgeProps, Node, NodeProps, Viewport } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { formatValue } from "../experiment.ts";
import type { ComputedNode, NodeId, Snapshot, Value } from "../experiment.ts";
import {
  computationCount,
  nodeLabels,
  operationTraces,
  requestCount,
  traceFrame,
} from "../trace.ts";
import type { OperationTrace } from "../trace.ts";

const formulas = {
  threshold: "минимальная продажа",
  filtered: "продажа ≥ порог",
  sum: "sum(выборка)",
  count: "length(выборка)",
  average: "сумма / количество",
};
type GraphNode = Node<
  { title: string; formula: string; value: Value | undefined; calls?: number },
  "experiment"
>;
type TreeNode = Node<
  {
    node: NodeId;
    order: number;
    value: Value | undefined;
    status: string;
    executions?: number;
    requestId?: number;
    kind: "request" | "validation" | "write";
    active: boolean;
  },
  "tree"
>;
type TreeEdge = Edge<{ ready: boolean; active: boolean }, "tree-edge">;

function ExperimentNode({ id, data }: NodeProps<GraphNode>) {
  return (
    <div className={`graph-node ${id === "average" ? "graph-node-result" : ""}`}>
      {id !== "threshold" && <Handle type="target" position={Position.Left} />}
      <div className="node-heading">
        <strong>{data.title}</strong>
        <Hint text="Сущность @preact/signals-core"><Badge variant="outline" tabIndex={0}>
          {id === "threshold" ? "signal" : "computed"}
        </Badge></Hint>
      </div>
      <div className="node-value">{formatValue(data.value)}</div>
      <div className="node-formula">{data.formula}</div>
      {data.calls !== undefined && (
        <div className="node-counter" data-testid={`calls-${id}`}>
          {computationCount(data.calls)} с начала прогона
        </div>
      )}
      {id !== "average" && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

function RequestNode({ data }: NodeProps<TreeNode>) {
  return (
    <div
      className={`request-card ${data.active ? "request-card-active" : ""}`}
      data-testid="request-card"
      data-request-id={data.requestId}
      data-node={data.node}
      data-kind={data.kind}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Left} />
      <div className="request-card-heading">
        <span className="request-order">{data.order}</span>
        <strong>{data.kind === "write" ? "Запись порога" : nodeLabels[data.node]}</strong>
        {data.requestId !== undefined && <span className="request-id">#{data.requestId}</span>}
      </div>
      <div className="request-card-result">
        {data.value === undefined ? "Ожидает завершения" : formatValue(data.value)}
      </div>
      <div className="request-card-status">
        <span>{data.status}</span>
        {data.executions !== undefined && <span>+{computationCount(data.executions)}</span>}
      </div>
    </div>
  );
}

function RequestEdge(props: EdgeProps<TreeEdge>) {
  // The left gutter keeps an edge to a later sibling away from intervening cards.
  const gutter = Math.min(props.sourceX, props.targetX) - 24;
  const path = `M ${props.sourceX} ${props.sourceY} H ${gutter} V ${props.targetY} H ${props.targetX}`;
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      data-testid={`edge-${props.target}`}
      data-source={props.source}
      data-target={props.target}
      style={{
        stroke: props.data?.active ? "var(--primary)" : "var(--muted-foreground)",
        strokeWidth: props.data?.active ? 2.5 : 1.5,
        strokeDasharray: props.data?.ready ? "6 4" : undefined,
      }}
    />
  );
}

const nodeTypes = { experiment: ExperimentNode, tree: RequestNode };
const edgeTypes = { "tree-edge": RequestEdge };
const dependencyPositions: Record<NodeId, { x: number; y: number }> = {
  threshold: { x: 0, y: 140 },
  filtered: { x: 280, y: 140 },
  sum: { x: 560, y: 0 },
  count: { x: 560, y: 280 },
  average: { x: 840, y: 140 },
};
const dependencyEdges: Edge[] = [
  ["threshold", "filtered"],
  ["filtered", "sum"],
  ["filtered", "count"],
  ["sum", "average"],
  ["count", "average"],
].map(([source, target]) => ({
  id: `${source}-${target}`,
  source,
  target,
  markerEnd: { type: MarkerType.ArrowClosed },
  type: "smoothstep",
}));

function Dependencies({ snapshot, viewport, theme }: { snapshot: Snapshot; viewport: MutableRefObject<Viewport | null>; theme: "light" | "dark" }) {
  const nodes: GraphNode[] = (["threshold", "filtered", "sum", "count", "average"] as NodeId[]).map(
    (id) => ({
      id,
      type: "experiment",
      position: dependencyPositions[id],
      data: {
        title: nodeLabels[id],
        formula: formulas[id],
        value: id === "threshold" ? snapshot.threshold : snapshot.values[id],
        calls: id === "threshold" ? undefined : snapshot.calls[id],
      },
    }),
  );
  return <FlowCanvas nodes={nodes} edges={dependencyEdges} viewport={viewport} theme={theme} />;
}

function FlowCanvas({
  nodes,
  edges,
  reading = false,
  controls,
  viewport,
  theme,
}: {
  theme: "light" | "dark";
  viewport: MutableRefObject<Viewport | null>;
  nodes: (GraphNode | TreeNode)[];
  edges: Edge[];
  reading?: boolean;
  controls?: React.ReactNode;
}) {
  return (
    <div
      className={`graph ${reading ? "graph-reading" : ""}`}
      aria-label={reading ? "Дерево обращений" : "Граф зависимостей"}
      data-testid="graph"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        colorMode={theme}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={viewport.current ?? undefined}
        fitView={viewport.current === null}
        fitViewOptions={{ padding: reading ? 0.12 : 0.18 }}
        onMove={(_, nextViewport) => { viewport.current = nextViewport; }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.15}
        maxZoom={1.5}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": "Увеличить граф",
          "controls.zoomOut.ariaLabel": "Уменьшить граф",
          "controls.fitView.ariaLabel": "Вместить граф",
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="color-mix(in oklch, var(--muted-foreground) 45%, var(--muted))" gap={22} size={1.5} />
        <Controls showInteractive={false} />
        {controls && (
          <Panel position="top-center" className="reading-panel">
            {controls}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function ReadingView({ snapshot, trace, viewport, theme }: { snapshot: Snapshot; trace: OperationTrace; viewport: MutableRefObject<Viewport | null>; theme: "light" | "dark" }) {
  const [step, setStep] = useState<number | null>(null);
  const frame = traceFrame(snapshot.log, trace, step);
  const computations =
    Object.values(trace.after.calls).reduce((sum, count) => sum + count, 0) -
    Object.values(trace.before.calls).reduce((sum, count) => sum + count, 0);
  const completedComputations = Object.values(frame.delta).reduce((sum, count) => sum + count, 0);
  const root = trace.requests.find((item) => item.request?.from === "external");
  const rootCompleted = root !== undefined && root.end < frame.end;
  const current = step === null ? null : trace.timeline[step];
  const depth = new Map<string, number>();
  const nodes: TreeNode[] = trace.timeline.map((item, index) => {
    const level = item.parentCardId === null ? 0 : (depth.get(item.parentCardId) ?? -1) + 1;
    depth.set(item.id, level);
    const complete = item.end < frame.end;
    const status = !complete
      ? item.kind === "validation"
        ? "Проверка зависимости · выполняется"
        : "В процессе"
      : item.kind === "validation"
        ? "Проверка зависимости · вычислилось"
        : item.node === "threshold"
          ? "Прочитали сигнал"
          : item.executions
            ? "Вычислилось"
            : "Готовое значение";
    return {
      id: item.id,
      type: "tree",
      position: { x: level * 105, y: index * 128 },
      hidden: step !== null && index > step,
      data: {
        node: item.node,
        order: index + 1,
        requestId: item.request?.id,
        kind: item.kind,
        value: complete ? item.value : undefined,
        status,
        executions: complete && item.node !== "threshold" ? item.executions : undefined,
        active: step === index,
      },
    };
  });
  if (trace.operation.type === "write") {
    nodes.push({
      id: `write-${trace.start}`,
      type: "tree",
      position: { x: 0, y: 0 },
      data: {
        node: "threshold",
        order: 1,
        kind: "write",
        value: trace.after.threshold,
        status: `${computations} вычислений`,
        active: false,
      },
    });
  }
  const edges: TreeEdge[] = trace.timeline.flatMap((item, index) =>
    item.parentCardId === null
      ? []
      : [
          {
            id: `to-${item.id}`,
            type: "tree-edge" as const,
            source: item.parentCardId,
            target: item.id,
            hidden: step !== null && index > step,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: step === index ? "var(--primary)" : "var(--muted-foreground)",
            },
            data: {
              ready:
                item.end < frame.end &&
                item.kind === "request" &&
                item.node !== "threshold" &&
                item.executions === 0,
              active: step === index,
            },
          },
        ],
  );
  const relevant = (["average", "sum", "count", "filtered"] as ComputedNode[]).filter(
    (node) =>
      trace.requests.some((item) => item.node === node) ||
      trace.after.calls[node] !== trace.before.calls[node],
  );
  return (
    <>
      <div className="operation-summary" data-testid="operation-summary">
        <strong>
          Операция {trace.index + 1}:{" "}
          {trace.operation.type === "write"
            ? `запись порога = ${trace.after.threshold}`
            : `чтение среднего${rootCompleted ? ` = ${formatValue(root.value)}` : ""}`}
        </strong>
        <span>
          Вычислений: {completedComputations} · Обращений:{" "}
          {trace.requests.filter((item) => item.start < frame.end).length}
        </span>
        {trace.operation.type === "read" &&
          rootCompleted &&
          trace.requests.length === 1 &&
          computations === 0 && <span>Готовый результат · Новых обращений к зависимостям нет</span>}
        {relevant.length > 0 && (
          <ul className="operation-node-summary" aria-label="Сводка по узлам">
            {relevant.map((node) => {
              const requests = trace.requests.filter(
                (item) => item.node === node && item.start < frame.end,
              ).length;
              return (
                <li key={node} data-testid={`summary-${node}`}>
                  <strong>{nodeLabels[node]}</strong> · {requestCount(requests)} ·{" "}
                  {computationCount(frame.delta[node])} за операцию ·{" "}
                  {computationCount(frame.snapshot.calls[node])} с начала прогона
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        viewport={viewport}
        theme={theme}
        reading
        controls={
          <>
            <div className="reading-navigation">
              <Button
                size="sm"
                variant="outline"
                disabled={step === null}
                onClick={() => setStep(step === 0 ? null : step! - 1)}
              >
                Назад
              </Button>
              <span data-testid="reading-step">
                {step === null ? "Операция целиком" : `Шаг ${step + 1} из ${trace.timeline.length}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={trace.timeline.length === 0 || step === trace.timeline.length - 1}
                onClick={() => setStep(step === null ? 0 : step + 1)}
              >
                Вперёд
              </Button>
              {step !== null && (
                <Button size="sm" variant="ghost" onClick={() => setStep(null)}>
                  Вся операция
                </Button>
              )}
            </div>
            {current && (
              <p className="current-request" data-testid="current-request">
                {step! + 1}. {nodeLabels[current.node]}
                {current.kind === "validation" ? " · Проверка зависимости" : ""}
              </p>
            )}
          </>
        }
      />
      <p className="sr-only">
        Сверху вниз — начала обращений и проверок. На шаге показаны завершения до следующего начала;
        последний шаг включает завершение операции. Проверки показываются только по записанным
        запускам computed. Сводка показывает выбранный момент, таблица ниже — весь прогон.
      </p>
    </>
  );
}

export function Graph({
  snapshot,
  selectedEvent,
  selectionVersion,
  theme,
}: {
  theme: "light" | "dark";
  snapshot: Snapshot;
  selectedEvent: number | null;
  selectionVersion: number;
}) {
  const [mode, setMode] = useState<"dependencies" | "reading">("dependencies");
  const viewport = useRef<Viewport | null>(null);
  const traces = operationTraces(snapshot.log);
  const trace =
    selectedEvent === null
      ? traces.at(-1)
      : traces.find(
          (operation) => operation.start <= selectedEvent && selectedEvent < operation.end,
        );
  return (
    <div className="graph-surface">
      <div className="graph-toolbar" role="group" aria-label="Режим графа">
        <Hint text="Зависимости">
        <button
          type="button"
          className={`mode-icon ${mode === "dependencies" ? "active" : ""}`}
          aria-label="Зависимости"
          aria-pressed={mode === "dependencies"}
          onClick={() => setMode("dependencies")}
        >
          <Network size={17} aria-hidden="true" />
        </button>
        </Hint>
        <button
          type="button"
          role="switch"
          className="mode-switch"
          aria-label="Порядок чтения"
          aria-checked={mode === "reading"}
          onClick={() => setMode(mode === "dependencies" ? "reading" : "dependencies")}
        >
          <span />
        </button>
        <Hint text="Порядок чтения">
        <button
          type="button"
          className={`mode-icon ${mode === "reading" ? "active" : ""}`}
          aria-label="Порядок чтения"
          aria-pressed={mode === "reading"}
          onClick={() => setMode("reading")}
        >
          <ListTree size={17} aria-hidden="true" />
        </button>
        </Hint>
      </div>
      {mode === "dependencies" ? (
        <Dependencies key="dependencies" snapshot={snapshot} viewport={viewport} theme={theme} />
      ) : trace ? (
        <ReadingView key={`${trace.start}:${selectionVersion}`} snapshot={snapshot} trace={trace} viewport={viewport} theme={theme} />
      ) : (
        <>
          <Dependencies key="empty-reading" snapshot={snapshot} viewport={viewport} theme={theme} />
          <div className="operation-summary">Выберите операцию в журнале или прочитайте среднее.</div>
        </>
      )}
    </div>
  );
}
