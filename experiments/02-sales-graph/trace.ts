import { snapshotFromJournal } from "./experiment.ts";
import type { LogEntry } from "./experiment.ts";

export const nodeLabels = {
  threshold: "Порог",
  filtered: "Выборка",
  sum: "Сумма",
  count: "Количество",
  average: "Среднее",
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
    const requests = events.flatMap((event, offset) => {
      if (event.type !== "read-start" || event.from === "external") return [];
      const endOffset = events.findIndex(
        (entry) => entry.type === "read-end" && entry.id === event.id,
      );
      if (endOffset < 0) return [];
      const completed = events[endOffset];
      return [
        {
          ...event,
          from: event.from,
          start: start + offset,
          end: start + endOffset,
          value: completed.type === "read-end" ? completed.value : undefined,
          ready:
            event.to !== "threshold" &&
            !events.some(
              (entry) =>
                entry.type === "computed" &&
                entry.requestId === event.id &&
                entry.node === event.to,
            ),
        },
      ];
    });
    return { index, start, end, operation: log[start], before, after, requests };
  });
}

export type OperationTrace = ReturnType<typeof operationTraces>[number];

// Шаги идут по началам обращений. В кадр входят завершения до следующего начала.
// Поэтому вложенное вычисление появляется на карточке только после его завершения.
export function traceFrame(log: readonly LogEntry[], trace: OperationTrace, step: number | null) {
  const end = step === null ? trace.end : (trace.requests[step + 1]?.start ?? trace.end);
  const snapshot = snapshotFromJournal(log.slice(0, end));
  const delta = {
    filtered: snapshot.calls.filtered - trace.before.calls.filtered,
    sum: snapshot.calls.sum - trace.before.calls.sum,
    count: snapshot.calls.count - trace.before.calls.count,
    average: snapshot.calls.average - trace.before.calls.average,
  };
  return { snapshot, delta };
}

export function computationCount(count: number) {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${!teen && last === 1 ? "вычисление" : !teen && last >= 2 && last <= 4 ? "вычисления" : "вычислений"}`;
}
