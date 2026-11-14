import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  getSmoothStepPath,
} from "@xyflow/react";
import type { Edge, EdgeProps, Node, NodeProps, ReactFlowInstance } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatValue } from "../experiment.ts";
import type { ComputedNode, NodeId, Snapshot, Value } from "../experiment.ts";
import { computationCount, nodeLabels, operationTraces, traceFrame } from "../trace.ts";
import type { OperationTrace } from "../trace.ts";

const formulas = {
  threshold: "минимальная продажа",
  filtered: "продажа ≥ порог",
  sum: "sum(выборка)",
  count: "length(выборка)",
  average: "сумма / количество",
};
type GraphNode = Node<
  {
    title: string;
    formula: string;
    value: Value | undefined;
    calls?: number;
    delta?: number;
    reading: boolean;
  },
  "experiment"
>;
type ReadingEdge = Edge<
  { order: number; ready: boolean; active: boolean; dimmed: boolean },
  "reading"
>;

function ExperimentNode({ id, data }: NodeProps<GraphNode>) {
  const hasInput = data.reading ? id !== "average" : id !== "threshold";
  const hasOutput = data.reading ? id !== "threshold" : id !== "average";
  return (
    <div className={`graph-node ${id === "average" ? "graph-node-result" : ""}`}>
      {hasInput &&
        (data.reading && id === "filtered" ? (
          <>
            <Handle type="target" id="sum" position={Position.Left} style={{ top: "35%" }} />
            <Handle type="target" id="count" position={Position.Left} style={{ top: "65%" }} />
          </>
        ) : (
          <Handle type="target" position={Position.Left} />
        ))}
      <div className="node-heading">
        <strong>{data.title}</strong>
        <Badge variant="outline" title="Сущность @preact/signals-core">
          {id === "threshold" ? "signal" : "computed"}
        </Badge>
      </div>
      <div className="node-value">{formatValue(data.value)}</div>
      <div className="node-formula">{data.formula}</div>
      {data.calls !== undefined && (
        <div className="node-counter" data-testid={`calls-${id}`}>
          {computationCount(data.calls)} с начала прогона
        </div>
      )}
      {data.delta !== undefined && (
        <div className="node-delta" data-testid={`delta-${id}`}>
          +{data.delta} за эту операцию
        </div>
      )}
      {hasOutput && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

function RequestEdge(props: EdgeProps<ReadingEdge>) {
  const [path, x, y] = getSmoothStepPath(props);
  const { order, ready, active, dimmed } = props.data!;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{
          stroke: active ? "var(--primary)" : "var(--muted-foreground)",
          strokeWidth: active ? 3 : 1.5,
          strokeDasharray: ready ? "6 4" : undefined,
          opacity: dimmed ? 0.35 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`request-label ${active ? "request-active" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
            opacity: dimmed ? 0.4 : 1,
          }}
          data-testid={`request-${order}`}
          data-ready={ready}
          data-active={active}
          aria-label={`${order}. ${nodeLabels[props.source as NodeId]} → ${nodeLabels[props.target as NodeId]}${ready ? ": Готовый результат" : ""}`}
        >
          <strong>{order}</strong>
          {ready && <span>Готовый результат</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
const nodeTypes = { experiment: ExperimentNode };
const edgeTypes = { reading: RequestEdge };
const dependencyPositions: Record<NodeId, { x: number; y: number }> = {
  threshold: { x: 0, y: 140 },
  filtered: { x: 280, y: 140 },
  sum: { x: 560, y: 0 },
  count: { x: 560, y: 280 },
  average: { x: 840, y: 140 },
};
const readingPositions: Record<NodeId, { x: number; y: number }> = {
  average: { x: 0, y: 140 },
  sum: { x: 360, y: 0 },
  count: { x: 360, y: 280 },
  filtered: { x: 720, y: 140 },
  threshold: { x: 1080, y: 140 },
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

function Canvas({
  snapshot,
  trace,
  step = null,
  panel,
}: {
  snapshot: Snapshot;
  trace?: OperationTrace;
  step?: number | null;
  panel?: ReactNode;
}) {
  const reading = trace !== undefined;
  const container = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState<ReactFlowInstance<GraphNode> | null>(null);
  useEffect(() => {
    if (!flow || !container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void flow.fitView({ padding: 0.18 });
      });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [flow]);
  const frame = trace ? traceFrame(snapshot.log, trace, step) : null;
  const shown = frame?.snapshot ?? snapshot;
  const nodes: GraphNode[] = (["threshold", "filtered", "sum", "count", "average"] as NodeId[]).map(
    (id) => ({
      id,
      type: "experiment",
      position: (reading ? readingPositions : dependencyPositions)[id],
      data: {
        title: nodeLabels[id],
        formula: formulas[id],
        reading,
        value: id === "threshold" ? shown.threshold : shown.values[id],
        calls: id === "threshold" ? undefined : shown.calls[id],
        delta: id === "threshold" ? undefined : frame?.delta[id],
      },
    }),
  );
  const edges: Edge[] = trace
    ? trace.requests.map((request, index) => ({
        id: `request-${request.id}`,
        type: "reading",
        source: request.from,
        target: request.to,
        targetHandle: request.to === "filtered" ? request.from : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: step === index ? "var(--primary)" : "var(--muted-foreground)",
        },
        data: {
          order: index + 1,
          ready: request.ready,
          active: step === index,
          dimmed: step !== null && step !== index,
        },
      }))
    : dependencyEdges;
  return (
    <div
      ref={container}
      className={`graph ${reading ? "graph-reading" : ""}`}
      aria-label="Граф зависимостей"
      data-testid="graph"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        onInit={setFlow}
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
        <Background color="var(--border)" gap={22} size={1} />
        <Controls showInteractive={false} />
        {panel && (
          <Panel position="top-left" className="reading-panel">
            {panel}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function ReadingView({ snapshot, trace }: { snapshot: Snapshot; trace: OperationTrace }) {
  const [step, setStep] = useState<number | null>(null);
  const computations =
    Object.values(trace.after.calls).reduce((sum, count) => sum + count, 0) -
    Object.values(trace.before.calls).reduce((sum, count) => sum + count, 0);
  const request = step === null ? null : trace.requests[step];
  const result = trace.after.readings.at(-1);
  return (
    <>
      <div className="operation-summary" data-testid="operation-summary">
        <strong>
          Операция {trace.index + 1}:{" "}
          {trace.operation.type === "write"
            ? `запись порога = ${trace.after.threshold}`
            : `чтение среднего = ${formatValue(result)}`}
        </strong>
        <span>
          Вычислений: {computations} · Обращений к зависимостям: {trace.requests.length}
        </span>
        {trace.operation.type === "read" && trace.requests.length === 0 && (
          <span>Готовый результат · Новых обращений к зависимостям нет</span>
        )}
      </div>
      <Canvas
        snapshot={snapshot}
        trace={trace}
        step={step}
        panel={
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
                {step === null
                  ? "Операция целиком"
                  : `Обращение ${step + 1} из ${trace.requests.length}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={trace.requests.length === 0 || step === trace.requests.length - 1}
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
            {request && (
              <p className="current-request" data-testid="current-request">
                {step! + 1}. {nodeLabels[request.from]} → {nodeLabels[request.to]}
                {request.ready ? " · Готовый результат" : ""}
              </p>
            )}
          </>
        }
      />
      <p className="trace-explanation">
        Стрелки — по началу обращения. В шаг входят завершения до следующего обращения; последний
        шаг — до конца операции. Карточки показывают историю, таблица ниже — весь прогон. Preact
        может проверять зависимости до входа в формулу: такие выполнения тоже записаны в журнал.
      </p>
    </>
  );
}

export function Graph({
  snapshot,
  selectedEvent,
  selectionVersion,
}: {
  snapshot: Snapshot;
  selectedEvent: number | null;
  selectionVersion: number;
}) {
  const [mode, setMode] = useState<"dependencies" | "reading">("dependencies");
  const traces = operationTraces(snapshot.log);
  const trace =
    selectedEvent === null
      ? traces.at(-1)
      : traces.find(
          (operation) => operation.start <= selectedEvent && selectedEvent < operation.end,
        );
  return (
    <>
      <div className="graph-toolbar" role="group" aria-label="Режим графа">
        <Button
          size="sm"
          variant={mode === "dependencies" ? "default" : "outline"}
          aria-pressed={mode === "dependencies"}
          onClick={() => setMode("dependencies")}
        >
          Зависимости
        </Button>
        <Button
          size="sm"
          variant={mode === "reading" ? "default" : "outline"}
          aria-pressed={mode === "reading"}
          onClick={() => setMode("reading")}
        >
          Порядок чтения
        </Button>
      </div>
      {mode === "dependencies" ? (
        <Canvas key="dependencies" snapshot={snapshot} />
      ) : trace ? (
        <ReadingView key={`${trace.start}:${selectionVersion}`} snapshot={snapshot} trace={trace} />
      ) : (
        <div className="operation-summary">Выберите операцию в журнале или прочитайте среднее.</div>
      )}
    </>
  );
}
