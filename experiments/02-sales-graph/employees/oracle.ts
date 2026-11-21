import { departments, generateEmployees } from "./recording.ts";
import type { Recording, Step } from "./recording.ts";
import type { Result } from "./engine.ts";

// Отдельная реализация над плоским массивом. Вход — те же исходные данные и команды.
export function createOracle(recording: Pick<Recording, "data" | "initial">) {
  const people = generateEmployees(recording.data);
  const state = { ...recording.initial };
  function calculate(step: Step): { result: Result; orderedIds: number[] } {
    const action = step.action;
    switch (action.type) {
      case "search": state.query = action.query; state.page = 0; break;
      case "filter": state.department = action.department; state.page = 0; break;
      case "sort": state.sort = action.sort; state.page = 0; break;
      case "page": state.page = action.page; break;
      case "phone": people.find(({ id }) => id === action.id)!.phone = action.phone; break;
      case "department": people.find(({ id }) => id === action.id)!.department = action.department; break;
      case "summary": state.summary = action.open; break;
      case "read": break;
    }
    const name = state.query.trim().toLocaleLowerCase("ru");
    const matching = people.filter((employee) =>
      (state.department === "" || employee.department === state.department) &&
      employee.name.toLocaleLowerCase("ru").includes(name));
    matching.sort((a, b) => {
      if (state.sort === "id") return a.id - b.id;
      const direction = state.sort === "name" ? 1 : -1;
      const difference = a.name.localeCompare(b.name, "ru");
      return difference === 0 ? a.id - b.id : direction * difference;
    });
    const total = matching.length;
    const pages = Math.ceil(total / state.pageSize);
    const page = pages === 0 ? 0 : Math.min(state.page, pages - 1);
    const result: Result = { rows: [], pagination: { total, pages, page } };
    for (let i = page * state.pageSize; i < total && i < (page + 1) * state.pageSize; i++) {
      result.rows.push({ ...matching[i] });
    }
    if (step.outputs.includes("summary")) {
      result.summary = [];
      for (const department of departments) {
        const count = matching.reduce((sum, employee) => sum + Number(employee.department === department), 0);
        if (count > 0) result.summary.push([department, count]);
      }
    }
    return { result, orderedIds: matching.map(({ id }) => id) };
  }
  return { calculate };
}

export function difference(expected: unknown, actual: unknown, key: string): string | undefined {
  if (Object.is(expected, actual)) return;
  if (expected && actual && typeof expected === "object" && typeof actual === "object" &&
    Array.isArray(expected) === Array.isArray(actual)) {
    if (Array.isArray(expected) && Array.isArray(actual) && expected.length !== actual.length) {
      return key + ".length: ожидалось " + expected.length + ", получено " + actual.length;
    }
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    for (const part of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const mismatch = difference(left[part], right[part], key + "." + part);
      if (mismatch) return mismatch;
    }
    return;
  }
  return key + ": ожидалось " + JSON.stringify(expected) + ", получено " + JSON.stringify(actual);
}
