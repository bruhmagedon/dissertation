import { computed, signal } from "@preact/signals-core";
import { createSelector, lruMemoize } from "reselect";
import { departments, generateEmployees, makeStep } from "./recording.ts";
import type { Action, Department, Employee, Output, Recording, Sort, Step, View } from "./recording.ts";

export const engines = ["preact", "reselect"] as const;
export type Engine = typeof engines[number];
export const engineLabels: Record<Engine, string> = { preact: "Preact Signals", reselect: "Reselect" };
export const engineVersions: Record<Engine, string> = { preact: "1.14.5", reselect: "5.1.1" };
export const candidates = ["filtered", "pageIds", "summary"] as const;
export const policies = ["baseline", ...candidates] as const;
export type Candidate = typeof candidates[number];
export type Policy = typeof policies[number];

type Person = Pick<Employee, "id" | "name" | "role">;
type Departments = ReadonlyMap<number, Department>;
type Phones = ReadonlyMap<number, string>;
interface Inputs {
  directory: ReadonlyMap<number, Person>;
  departments: Departments;
  phones: Phones;
  query: string;
  filter: Department | "";
  sort: Sort;
  page: number;
  pageSize: number;
}
export type Input = keyof Inputs;
export interface Pagination { page: number; pages: number; total: number }
export type Summary = [Department, number][];
export interface Values {
  filtered: number[];
  sorted: number[];
  pageIds: number[];
  rows: Employee[];
  pagination: Pagination;
  summary: Summary;
}
export type Node = keyof Values;
export type NodeId = Node | Input;
export type DependencyGraph = Partial<Record<Node, NodeId[]>>;
export type Result = Pick<Values, "rows" | "pagination"> & Partial<Pick<Values, "summary">>;

export const labels: Record<NodeId, string> = {
  directory: "Справочник", departments: "Отделы", phones: "Телефоны",
  query: "Поиск", filter: "Фильтр", sort: "Режим сортировки", page: "Номер страницы", pageSize: "Размер страницы",
  filtered: "Отбор", sorted: "Сортировка", pageIds: "ID страницы",
  rows: "Строки", pagination: "Пагинация", summary: "Сводка",
};
export const policyLabels: Record<Policy, string> = {
  baseline: "Базовая", filtered: "Отбор", pageIds: "ID страницы", summary: "Сводка",
};

interface Ref<T> { id: NodeId; read: (state: Inputs) => T }
type Refs<T extends unknown[]> = { [K in keyof T]: Ref<T[K]> };

export type Event =
  | { kind: "request"; node: Output }
  | { kind: "read"; node: NodeId; from: Node | "screen"; id: number; parent: number | null }
  | { kind: "execute"; node: Node; within: number | null; value: unknown }
  | { kind: "compare"; node: Candidate; equal: boolean; inspected: number; reason: string };
export interface Evaluation {
  node: Node;
  changed: NodeId[];
  compute?: () => unknown;
  comparison?: { equal: boolean; measure: () => boolean };
}
export interface Frame {
  step: Step;
  result: Result;
  events: Event[];
  evaluations: Evaluation[];
  orderedIds?: number[];
}
interface Trace {
  events: Event[];
  evaluations: Evaluation[];
  activeRead: number | null;
  nextRead: number;
}

const collator = new Intl.Collator("ru");
function select(directory: Inputs["directory"], byDepartment: Departments, query: string, filter: Inputs["filter"]) {
  const needle = query.trim().toLocaleLowerCase("ru");
  const ids: number[] = [];
  for (const person of directory.values()) {
    if ((!filter || byDepartment.get(person.id) === filter) &&
      (!needle || person.name.toLocaleLowerCase("ru").includes(needle))) ids.push(person.id);
  }
  return ids;
}
function sortIds(ids: number[], mode: Sort, directory: Inputs["directory"]) {
  const direction = mode === "name-desc" ? -1 : 1;
  return [...ids].sort((a, b) => mode === "id" ? a - b :
    direction * collator.compare(directory.get(a)!.name, directory.get(b)!.name) || a - b);
}
function pagination(ids: number[], page: number, size: number): Pagination {
  const pages = Math.ceil(ids.length / size);
  return { page: Math.min(page, Math.max(0, pages - 1)), pages, total: ids.length };
}
function pageIds(ids: number[], info: Pagination, size: number) {
  return ids.slice(info.page * size, (info.page + 1) * size);
}
function rows(ids: number[], directory: Inputs["directory"], byDepartment: Departments, phones: Phones): Employee[] {
  return ids.map((id) => ({ ...directory.get(id)!, department: byDepartment.get(id)!, phone: phones.get(id)! }));
}
function summary(ids: number[], byDepartment: Departments): Summary {
  const counts = new Map<Department, number>();
  for (const id of ids) {
    const department = byDepartment.get(id)!;
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }
  return departments.flatMap((department) => counts.has(department) ? [[department, counts.get(department)!]] : []);
}

// -1 — длина, индекс — первый несовпавший элемент, length — совпадение.
export function firstMismatch(node: Candidate, previous: readonly unknown[], next: readonly unknown[]): number {
  if (previous.length !== next.length) return -1;
  for (let index = 0; index < next.length; index++) {
    if (node === "summary") {
      const [oldDepartment, oldCount] = previous[index] as Summary[number];
      const [department, count] = next[index] as Summary[number];
      if (oldDepartment !== department || oldCount !== count) return index;
    } else if (previous[index] !== next[index]) return index;
  }
  return next.length;
}

function preview(value: unknown) {
  return Array.isArray(value) && value.length > 12
    ? { length: value.length, first: value.slice(0, 6) }
    : value;
}

function updateMap<T>(map: ReadonlyMap<number, T>, id: number, value: T): ReadonlyMap<number, T> {
  return map.get(id) === value ? map : new Map(map).set(id, value);
}

export function createEmployeeRun(
  recording: Pick<Recording, "data" | "initial">,
  engine: Engine,
  policy: Policy,
  mode: "timing" | "diagnostic" | "calibration" = "diagnostic",
) {
  const people = generateEmployees(recording.data);
  const initial = recording.initial;
  let view: View = { ...initial };
  let state: Inputs = {
    directory: new Map(people.map(({ id, name, role }) => [id, { id, name, role }])),
    departments: new Map(people.map(({ id, department }) => [id, department])),
    phones: new Map(people.map(({ id, phone }) => [id, phone])),
    query: view.query, filter: view.department, sort: view.sort, page: view.page, pageSize: view.pageSize,
  };
  const updateSignals: ((before: Inputs, next: Inputs) => void)[] = [];
  let trace: Trace | undefined;
  const graph: DependencyGraph = {};
  let orderedIds: number[] | undefined;

  function source<K extends Input>(id: K): Ref<Inputs[K]> {
    if (engine === "reselect") return { id, read: (input) => input[id] };
    const value = signal(state[id]);
    updateSignals.push((before, next) => {
      if (before[id] !== next[id]) value.value = next[id];
    });
    return { id, read: () => value.value };
  }

  function observe<T>(ref: Ref<T>, from: Node | "screen"): Ref<T>["read"] {
    if (mode === "timing") return ref.read;
    return (input) => {
      if (!trace) return ref.read(input);
      const parent = trace.activeRead;
      const id = trace.nextRead++;
      trace.events.push({ kind: "read", node: ref.id, from, id, parent });
      trace.activeRead = id;
      try { return ref.read(input); }
      finally { trace.activeRead = parent; }
    };
  }

  function node<K extends Node, Args extends unknown[]>(
    id: K, deps: Refs<Args>, transform: (...args: Args) => Values[K],
  ): Ref<Values[K]> {
    graph[id] = deps.map((dep) => dep.id);
    const readers = deps.map((dep) => observe(dep, id));
    let previousArgs: Args | undefined;
    let previousValue: Values[K] | undefined;

    function evaluate(...args: Args) {
      const value = transform(...args);
      if (trace) {
        if (id === "sorted") orderedIds = value as number[];
        const changed = deps.filter((_, index) => !previousArgs || previousArgs[index] !== args[index]).map((dep) => dep.id);
        const evaluation: Evaluation = { node: id, changed };
        if (mode === "calibration") {
          evaluation.compute = () => transform(...args);
          if (previousValue !== undefined && candidates.some((candidate) => candidate === id)) {
            const key = id as Candidate;
            const before = previousValue as readonly unknown[];
            const next = value as readonly unknown[];
            const measure = () => firstMismatch(key, before, next) === next.length;
            evaluation.comparison = { equal: measure(), measure };
          }
        }
        previousValue = value;
        previousArgs = args;
        trace.evaluations.push(evaluation);
        trace.events.push({ kind: "execute", node: id, within: trace.activeRead, value: preview(value) });
      }
      return value;
    }

    function equality(before: Values[K], current: Values[K]) {
      const left = before as readonly unknown[];
      const right = current as readonly unknown[];
      const key = id as Candidate;
      const index = firstMismatch(key, left, right);
      const equal = index === right.length;
      if (trace) trace.events.push({
        kind: "compare", node: key, equal, inspected: index < 0 ? 0 : equal ? index : index + 1,
        reason: index < 0 ? "разная длина" : equal ? "полное совпадение" : "различие в позиции " + (index + 1),
      });
      return equal;
    }

    const selected = policy === id;
    if (engine === "reselect") {
      const selector = createSelector(
        readers,
        (...args: unknown[]) => evaluate(...args as Args),
        {
          memoize: lruMemoize,
          memoizeOptions: { maxSize: 1, ...(selected ? { resultEqualityCheck: equality } : {}) },
          argsMemoize: lruMemoize,
          argsMemoizeOptions: { maxSize: 1 },
          devModeChecks: { identityFunctionCheck: "never", inputStabilityCheck: "never" },
        },
      );
      return { id, read: selector };
    }

    let last: Values[K] | undefined;
    const derived = computed(() => {
      const next = evaluate(...readers.map((read) => read(state)) as Args);
      if (!selected) return next;
      if (last !== undefined && equality(last, next)) return last;
      last = next;
      return next;
    });
    return { id, read: () => derived.value };
  }

  const directory = source("directory");
  const byDepartment = source("departments");
  const phones = source("phones");
  const page = source("page");
  const pageSize = source("pageSize");
  const filtered = node("filtered", [directory, byDepartment, source("query"), source("filter")], select);
  const sorted = node("sorted", [filtered, source("sort"), directory], sortIds);
  const info = node("pagination", [filtered, page, pageSize], pagination);
  const visible = node("pageIds", [sorted, info, pageSize], pageIds);
  const readRows = observe(node("rows", [visible, directory, byDepartment, phones], rows), "screen");
  const readPagination = observe(info, "screen");
  const readSummary = observe(node("summary", [filtered, byDepartment], summary), "screen");

  function write(patch: Partial<Inputs>) {
    if ((Object.keys(patch) as Input[]).every((key) => state[key] === patch[key])) return;
    const before = state;
    state = { ...state, ...patch };
    for (const update of updateSignals) update(before, state);
  }

  function change(action: Action) {
    switch (action.type) {
      case "search":
        view.query = action.query;
        write({ query: action.query, page: 0 });
        break;
      case "filter":
        view.department = action.department;
        write({ filter: action.department, page: 0 });
        break;
      case "sort":
        view.sort = action.sort;
        write({ sort: action.sort, page: 0 });
        break;
      case "page":
        write({ page: action.page });
        break;
      case "summary":
        view.summary = action.open;
        break;
      case "phone":
        write({ phones: updateMap(state.phones, action.id, action.phone) });
        break;
      case "department":
        write({ departments: updateMap(state.departments, action.id, action.department) });
        break;
      case "read":
        break;
    }
  }

  function execute(step: Step): Result {
    change(step.action);
    if (trace) trace.events.push({ kind: "request", node: "rows" });
    const visibleRows = readRows(state);
    if (trace) trace.events.push({ kind: "request", node: "pagination" });
    const info = readPagination(state);
    view.page = info.page;
    const result: Result = { rows: visibleRows, pagination: info };
    if (step.outputs.includes("summary")) {
      if (trace) trace.events.push({ kind: "request", node: "summary" });
      result.summary = readSummary(state);
    }
    return result;
  }

  function capture(step: Step): Frame {
    trace = { events: [], evaluations: [], activeRead: null, nextRead: 1 };
    try {
      const result = execute(step);
      return {
        step, result: structuredClone(result), events: structuredClone(trace.events),
        evaluations: trace.evaluations, orderedIds: orderedIds?.slice(),
      };
    } finally { trace = undefined; }
  }

  return {
    execute, capture, graph,
    view: () => ({ ...view }),
    initialStep: makeStep({ type: "read" }, initial.summary),
  };
}
