import { snapshotFromJournal } from "./experiment.ts";
import type { ComputedNode, LogEntry, NodeId, Value } from "./experiment.ts";

export const nodeLabels: Record<NodeId, string> = {
  threshold: "Порог",
  filtered: "Выборка",
  sum: "Сумма",
  count: "Количество",
  average: "Среднее",
};

type RequestStart = Extract<LogEntry, { type: "read-start" }>;
type TimelineItem = {
  id: string;
  parentCardId: string | null;
  node: NodeId;
  start: number;
  end: number;
  value: Value;
  kind: "request" | "validation";
  executions: number;
  // Only explicit reads have a request ID and a recorded caller.
  request?: RequestStart;
};

export function operationTraces(log: readonly LogEntry[]) {
  const starts = log.flatMap((event, index) =>
    event.type === "read" || event.type === "write" ? [index] : [],
  );
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? log.length;
    const events = log.slice(start, end);
    const before = snapshotFromJournal(log.slice(0, start));
    const after = snapshotFromJournal(log.slice(0, end));
    const reads = new Map<number, RequestStart>();
    for (const event of events) if (event.type === "read-start") reads.set(event.id, event);
    const timeline: TimelineItem[] = [];
    const stack: { node: ComputedNode; call: number; requestId: number | null; cardId: string }[] =
      [];

    for (let offset = 0; offset < events.length; offset++) {
      const event = events[offset];
      if (event.type === "read-start") {
        const finish = events.findIndex((item) => item.type === "read-end" && item.id === event.id);
        if (finish < 0) continue;
        const returned = events[finish];
        if (returned.type !== "read-end") continue;
        // A computed may run during Preact's dependency refresh, without an explicit
        // read-start for that computed. Its card owns reads made inside its body.
        const owner = [...stack]
          .reverse()
          .find((item) => item.node === event.from && item.requestId === event.parentId);
        const parentCardId =
          event.parentId === null ? null : (owner?.cardId ?? String(event.parentId));
        const executions = events.filter(
          (item) => item.type === "value" && item.requestId === event.id && item.node === event.to,
        ).length;
        timeline.push({
          id: String(event.id),
          parentCardId,
          node: event.to,
          start: start + offset,
          end: start + finish,
          value: returned.value,
          kind: "request",
          executions,
          request: event,
        });
      } else if (event.type === "computed") {
        const requested = event.requestId === null ? undefined : reads.get(event.requestId);
        let cardId = String(event.requestId);
        if (requested && requested.to !== event.node) {
          const finish = events.findIndex(
            (item) =>
              item.type === "value" &&
              item.node === event.node &&
              item.call === event.call &&
              item.requestId === event.requestId,
          );
          const returned = events[finish];
          if (finish >= 0 && returned?.type === "value") {
            cardId = `validation-${event.node}-${event.call}-${event.requestId}`;
            const enclosing = [...stack]
              .reverse()
              .find((item) => item.requestId === event.requestId);
            timeline.push({
              id: cardId,
              parentCardId: enclosing?.cardId ?? String(event.requestId),
              node: event.node,
              start: start + offset,
              end: start + finish,
              value: returned.value,
              kind: "validation",
              executions: 1,
            });
          }
        }
        stack.push({ node: event.node, call: event.call, requestId: event.requestId, cardId });
      } else if (event.type === "value") {
        const position = stack.findLastIndex(
          (item) =>
            item.node === event.node &&
            item.call === event.call &&
            item.requestId === event.requestId,
        );
        if (position !== -1) stack.splice(position, 1);
      }
    }
    return {
      index,
      start,
      end,
      operation: log[start],
      before,
      after,
      timeline,
      requests: timeline.filter((item) => item.kind === "request"),
    };
  });
}

export type OperationTrace = ReturnType<typeof operationTraces>[number];

// A frame starts at an item and includes completions before the next start.
export function traceFrame(log: readonly LogEntry[], trace: OperationTrace, step: number | null) {
  const end = step === null ? trace.end : (trace.timeline[step + 1]?.start ?? trace.end);
  const snapshot = snapshotFromJournal(log.slice(0, end));
  const delta = {
    filtered: snapshot.calls.filtered - trace.before.calls.filtered,
    sum: snapshot.calls.sum - trace.before.calls.sum,
    count: snapshot.calls.count - trace.before.calls.count,
    average: snapshot.calls.average - trace.before.calls.average,
  };
  return { snapshot, delta, end };
}

export function computationCount(count: number) {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${!teen && last === 1 ? "вычисление" : !teen && last >= 2 && last <= 4 ? "вычисления" : "вычислений"}`;
}

export function requestCount(count: number) {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${!teen && last === 1 ? "обращение" : !teen && last >= 2 && last <= 4 ? "обращения" : "обращений"}`;
}
