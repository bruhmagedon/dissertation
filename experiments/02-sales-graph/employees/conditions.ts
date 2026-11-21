import { defaultView, demoRecording, generateEmployees, makeStep } from "./recording.ts";
import type { Action, Data, Department, Recording } from "./recording.ts";

export function borisRecording(filtered: boolean): Recording {
  const recording = demoRecording();
  return {
    ...recording,
    name: filtered ? "Контроль · Борис и фильтр «Продажи»" : "Демонстрация · перевод Бориса",
    steps: [
      makeStep({ type: "filter", department: filtered ? "Продажи" : "" }, false),
      makeStep({ type: "summary", open: true }, false),
      makeStep({ type: "department", id: 9, department: "Поддержка" }, true),
    ],
  };
}

export type Condition = "summary" | "filter";
export function transferPair(data: Data, kind: Condition, unchanged: { summary: boolean; filter: Department | "" }) {
  const from = kind === "summary" ? unchanged.filter || "Продажи" : "Продажи";
  const to = from === "Поддержка" ? "Продажи" : "Поддержка";
  const people = generateEmployees(data);
  const collator = new Intl.Collator("ru");
  people.sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
  // Все команды адресуют разных сотрудников, видимых на первой странице обоих вариантов.
  const actions: Action[] = people.slice(0, 100).filter(({ department }) => department === from).slice(0, 8)
    .map(({ id }) => ({ type: "department", id, department: to }));
  if (!actions.length) throw new Error("В исходной странице нет сотрудников выбранного отдела.");
  function recording(name: string, summary: boolean, department: Department | ""): Recording {
    return {
      schema: 1, profile: "custom", name, data,
      initial: { ...defaultView, pageSize: 100, summary, department },
      steps: actions.map((action) => makeStep(action, summary)),
    };
  }
  return kind === "summary"
    ? [recording("Сводка закрыта", false, unchanged.filter), recording("Сводка открыта", true, unchanged.filter)] as const
    : [recording("Все отделы", unchanged.summary, ""), recording("Фильтр «Продажи»", unchanged.summary, "Продажи")] as const;
}
