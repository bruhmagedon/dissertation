import { computed, signal } from "@preact/signals-core";

export type ComputedNode = "filtered" | "sum" | "count" | "average";
export type NodeId = ComputedNode | "threshold";
export type SelectionPreview = { kind: "selection"; length: number; examples: number[] };
export type Value = number | number[] | SelectionPreview | null;
export type Operation = { type: "read" } | { type: "write"; value: number };
export type LogEntry =
  | { type: "reset"; value: number; salesCount?: number; salesPreview?: number[] }
  | Operation
  | {
      type: "read-start";
      id: number;
      parentId: number | null;
      from: ComputedNode | "external";
      to: NodeId;
    }
  | { type: "read-end"; id: number; value: Value }
  | { type: "computed"; node: ComputedNode; call: number; requestId: number | null }
  | { type: "value"; node: ComputedNode; value: Value; call: number; requestId: number | null }
  | { type: "result"; value: number | null };

export const sales = [10, 20, 30, 40] as const;

export function generateSales(count: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > 100_000) {
    throw new RangeError("Количество продаж должно быть целым числом от 2 до 100 000.");
  }
  if (count === 4) return [...sales];
  return Array.from({ length: count }, (_, index) => index === 0 ? 10 : index + 11);
}

function journalValue(value: Value): Value {
  return Array.isArray(value) && value.length > 8
    ? { kind: "selection", length: value.length, examples: value.slice(0, 5) }
    : value;
}

export function selectionSize(value: Value | undefined): number | undefined {
  return Array.isArray(value) ? value.length : value && typeof value === "object" ? value.length : undefined;
}

export const selectionModes = [
  { id: "normal", label: "Обычная выборка", description: "Каждый вызов filter возвращает новый массив." },
  { id: "reuse-array", label: "Переиспользование массива", description: "Если длина и элементы совпадают по порядку, возвращается предыдущий массив." },
] as const;
export type SelectionMode = (typeof selectionModes)[number]["id"];

export const scenarios = {
  A: [
    { type: "read" },
    { type: "write", value: 20 },
    { type: "read" },
    { type: "write", value: 30 },
    { type: "read" },
    { type: "read" },
  ],
  B: [
    { type: "read" },
    { type: "write", value: 20 },
    { type: "write", value: 30 },
    { type: "read" },
    { type: "read" },
  ],
} as const satisfies Record<string, readonly Operation[]>;

// Только обычные события: здесь нет доступа к signals.
export function snapshotFromJournal(journal: readonly LogEntry[]) {
  const log: LogEntry[] = structuredClone([...journal]);
  const calls = { filtered: 0, sum: 0, count: 0, average: 0 };
  const values: Partial<Record<ComputedNode, Value>> = {};
  const readings: (number | null)[] = [];
  let threshold = 10;
  let evaluatedThreshold: number | null = null;
  let salesCount: number = sales.length;
  let salesPreview: number[] = [...sales];
  for (const event of log) {
    switch (event.type) {
      case "reset":
        salesCount = event.salesCount ?? sales.length;
        salesPreview = event.salesPreview ?? [...sales];
        threshold = event.value;
        break;
      case "write":
        threshold = event.value;
        break;
      case "value":
        calls[event.node] = event.call;
        values[event.node] = event.value;
        break;
      case "result":
        readings.push(event.value);
        evaluatedThreshold = threshold;
        break;
    }
  }
  return { threshold, evaluatedThreshold, calls, values, readings, log, salesCount, salesPreview };
}
export type Snapshot = ReturnType<typeof snapshotFromJournal>;

export function createExperiment(mode: SelectionMode = "normal", inputSales: readonly number[] = sales) {
  let previousSelection: number[] | undefined;
  const threshold = signal(10);
  const calls = { filtered: 0, sum: 0, count: 0, average: 0 };

  const journal: LogEntry[] = [{ type: "reset", value: 10, salesCount: inputSales.length, salesPreview: inputSales.slice(0, 5) }];

  let nextRequestId = 1;
  let activeRequestId: number | null = null;
  // Оборачиваем ровно существующее чтение; не подписываемся и не читаем дополнительно.
  function readValue<T extends Value>(
    from: ComputedNode | "external",
    to: NodeId,
    read: () => T,
  ): T {
    const id = nextRequestId++;
    const parentId = activeRequestId;
    journal.push({ type: "read-start", id, parentId, from, to });
    activeRequestId = id;
    try {
      const value = read();
      journal.push({ type: "read-end", id, value: journalValue(value) });
      return value;
    } finally {
      activeRequestId = parentId;
    }
  }
  function called(node: ComputedNode) {
    journal.push({ type: "computed", node, call: ++calls[node], requestId: activeRequestId });
  }

  function recorded<T extends Value>(node: ComputedNode, value: T): T {
    journal.push({ type: "value", node, value: journalValue(value), call: calls[node], requestId: activeRequestId });
    return value;
  }

  const filtered = computed(() => {
    called("filtered");
    const minimum = readValue("filtered", "threshold", () => threshold.value);
    const next = inputSales.filter((sale) => sale >= minimum);
    if (mode === "reuse-array" && previousSelection &&
      next.length === previousSelection.length &&
      next.every((sale, index) => sale === previousSelection![index])) {
      return recorded("filtered", previousSelection);
    }
    previousSelection = next;
    return recorded("filtered", next);
  });

  const sum = computed(() => {
    called("sum");
    return recorded(
      "sum",
      readValue("sum", "filtered", () => filtered.value).reduce((total, sale) => total + sale, 0),
    );
  });

  const count = computed(() => {
    called("count");
    return recorded("count", readValue("count", "filtered", () => filtered.value).length);
  });

  const average = computed(() => {
    called("average");
    const total = readValue("average", "sum", () => sum.value);
    const size = readValue("average", "count", () => count.value);
    // Пустая выборка явно обозначена; снимки остаются JSON-совместимыми.
    return recorded("average", size === 0 ? null : total / size);
  });

  return {
    snapshot: () => snapshotFromJournal(journal),
    execute(operation: Operation) {
      if (operation.type === "write" && !Number.isFinite(operation.value)) {
        throw new Error("Порог должен быть конечным числом.");
      }
      journal.push({ ...operation });
      if (operation.type === "write") threshold.value = operation.value;
      else
        journal.push({
          type: "result",
          value: readValue("external", "average", () => average.value),
        });
      return snapshotFromJournal(journal);
    },
  };
}

export function runScenario(name: keyof typeof scenarios, mode: SelectionMode = "normal") {
  const experiment = createExperiment(mode);
  for (const operation of scenarios[name]) experiment.execute(operation);
  return experiment;
}

export function compareOperations(operations: readonly Operation[], salesCount: number) {
  const data = generateSales(salesCount);
  return selectionModes.map(({ id }) => {
    const experiment = createExperiment(id, data);
    for (const operation of operations) experiment.execute(operation);
    return { mode: id, experiment, snapshot: experiment.snapshot() };
  });
}

export function formatValue(value: Value | undefined): string {
  if (value === undefined) return "Не вычислено";
  if (value === null) return "Нет продаж";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "object") return `${value.length.toLocaleString("ru-RU")} строк · [${value.examples.join(", ")}, …]`;
  return String(value);
}
export function formatEntry(event: LogEntry): string {
  switch (event.type) {
    case "reset":
      return `Новый граф, порог = ${event.value} · ${(event.salesCount ?? 4).toLocaleString("ru-RU")} продаж`;
    case "write":
      return `Операция: записать порог = ${event.value}`;
    case "read":
      return "Операция: прочитать среднее";
    case "read-start":
      return `Запрос #${event.id}: ${event.from} → ${event.to} (родитель: ${event.parentId ?? "нет"})`;
    case "read-end":
      return `Ответ #${event.id}: ${formatValue(event.value)}`;
    case "computed":
      return `computed ${event.node} #${event.call} (запрос #${event.requestId})`;
    case "value":
      return `${event.node} #${event.call} вернул ${formatValue(event.value)} (запрос #${event.requestId})`;
    case "result":
      return `Результат: ${formatValue(event.value)}`;
  }
}
