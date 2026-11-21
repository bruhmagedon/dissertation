import { departments, generateEmployees, makeStep, sizes, sorts } from "./recording.ts";
import type { Action, Data, Department, Recording, Step, View } from "./recording.ts";

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && min <= value && value <= max;
}
function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((item) => value === item);
}
function validDepartment(value: unknown): value is Department | "" {
  return value === "" || member(departments, value);
}

function validAction(action: unknown, ids: Set<number>): action is Action {
  if (!object(action)) return false;
  switch (action.type) {
    case "read": return true;
    case "search": return typeof action.query === "string" && action.query.length <= 120;
    case "filter": return validDepartment(action.department);
    case "sort": return member(sorts, action.sort);
    case "page": return integer(action.page, 0, 10_000);
    case "summary": return typeof action.open === "boolean";
    case "phone": return typeof action.id === "number" && ids.has(action.id) &&
      typeof action.phone === "string" && action.phone.trim().length > 0 && action.phone.length <= 40;
    case "department": return typeof action.id === "number" && ids.has(action.id) && member(departments, action.department);
    default: return false;
  }
}

export function parseRecording(value: unknown): Recording {
  if (!object(value) || value.schema !== 1) throw new Error("Поддерживается версия записи 1.");
  const { name, profile, data, initial, steps } = value;
  const profiles: Recording["profile"][] = ["editing", "departments", "mixed", "demo", "custom"];
  if (typeof name !== "string" || !name.trim() || name.length > 120 || !member(profiles, profile)) {
    throw new Error("Проверьте название и профиль записи.");
  }
  if (!object(data) || (data.kind !== "demo" && (data.kind !== "generated" ||
    !sizes.some((size) => data.size === size) || !integer(data.seed, 0, 0xffffffff)))) {
    throw new Error("Нужен демонстрационный набор или 100, 1 000, 10 000 сотрудников и seed от 0 до 4294967295.");
  }
  if (!object(initial) || typeof initial.query !== "string" || initial.query.length > 120 ||
    !validDepartment(initial.department) || !member(sorts, initial.sort) ||
    !integer(initial.page, 0, 10_000) || !integer(initial.pageSize, 1, 100) || typeof initial.summary !== "boolean") {
    throw new Error("Начальное состояние таблицы имеет неверный формат.");
  }
  if (!Array.isArray(steps) || steps.length > 500) throw new Error("Запись должна содержать массив из максимум 500 действий.");
  const ids = new Set(generateEmployees(data as Data).map(({ id }) => id));
  let summary = initial.summary;
  for (const [index, step] of steps.entries()) {
    if (!object(step) || !validAction(step.action, ids)) throw new Error("Неверное действие №" + (index + 1) + " или ID вне набора.");
    const expected = makeStep(step.action, summary).outputs;
    const saved = step.outputs;
    if (!Array.isArray(saved) || saved.length !== expected.length ||
      !expected.every((output, position) => output === saved[position])) {
      throw new Error("Запрошенные выходы действия №" + (index + 1) + " не соответствуют видимости таблицы и сводки.");
    }
    summary = expected.includes("summary");
  }
  return { schema: 1, name, profile, data: data as Data, initial: initial as unknown as View, steps: steps as Step[] };
}
