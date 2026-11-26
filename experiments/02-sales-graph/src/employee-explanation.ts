import { labels } from "../employees/engine.ts";
import type { Event, Frame, NodeId } from "../employees/engine.ts";
import { difference } from "../employees/oracle.ts";
import { describeAction } from "../employees/recording.ts";
import type { Output } from "../employees/recording.ts";

export const screenOutputs = ["rows", "pagination", "summary"] as const;
export const plainLabels: Record<NodeId, string> = {
  ...labels,
  directory: "Имена и должности", departments: "Кто в каком отделе", phones: "Номера телефонов",
  query: "Строка поиска", filter: "Фильтр по отделу", sort: "Порядок строк", pageSize: "Строк на странице",
  activeDepartments: "Отделы для активного фильтра",
  filtered: "Кто подходит под условия", sorted: "Список в нужном порядке", pageIds: "Кто виден на странице",
  rows: "Строки таблицы", pagination: "Данные о страницах", summary: "Сводка по отделам",
};

export function actionTitle(frame: Frame, previous?: Frame) {
  const action = frame.step.action;
  if (action.type === "phone" || action.type === "department") {
    const person = (previous?.result.rows ?? []).find(({ id }) => id === action.id)
      ?? frame.result.rows.find(({ id }) => id === action.id);
    if (person) return action.type === "phone"
      ? `Новый телефон · ${person.name}`
      : `${person.name} меняет отдел на «${action.department}»`;
  }
  return action.type === "read" ? "Обновить данные на экране" : describeAction(action);
}

export function outputStatus(frame: Frame, previous: Frame | undefined, output: Output) {
  if (!frame.events.some((event) => event.kind === "request" && event.node === output)) return "Экран не запрашивал";
  if (!frame.evaluations.some(({ node }) => node === output)) return "Взяли готовое";
  if (previous?.result[output] === undefined) {
    return output === "summary" ? "Посчитали по текущему списку сотрудников" : "Посчитали";
  }
  return difference(previous.result[output], frame.result[output], output)
    ? "Пересчитали, результат изменился" : "Пересчитали, результат прежний";
}

export function outputDetails(frame: Frame, previous: Frame | undefined, output: Output) {
  const current = frame.result;
  const before = previous?.result;
  if (output === "summary") {
    if (!current.summary) return before?.summary ? "Сводку закрыли." : "Сводка закрыта.";
    return current.summary.length || before?.summary?.length
      ? [...new Set([...current.summary, ...(before?.summary ?? [])].map(([department]) => department))]
        .map((department) => {
          const next = current.summary!.find(([key]) => key === department)?.[1] ?? 0;
          const old = before?.summary?.find(([key]) => key === department)?.[1] ?? 0;
          return department + " " + (before?.summary && old !== next ? old + " → " : "") + next;
        }).join(" · ")
      : "В сводке нет сотрудников.";
  }
  if (output === "pagination") {
    const { page, pages, total } = current.pagination;
    if (!pages) return oldPaginationText(before?.pagination.pages);
    const old = before?.pagination;
    if (!old || !difference(old, current.pagination, output)) return `Страница ${page + 1} из ${pages} · в отборе ${total}`;
    return [
      old.page !== page ? `Страница ${old.page + 1} → ${page + 1}` : `Страница ${page + 1}`,
      old.pages !== pages ? `страниц ${old.pages} → ${pages}` : `из ${pages}`,
      `в отборе ${old.total !== total ? old.total + " → " : ""}${total}`,
    ].join(" · ");
  }

  const nextIds = current.rows.map(({ id }) => id);
  const oldIds = before?.rows.map(({ id }) => id);
  const people = (rows: Frame["result"]["rows"]) => rows.length
    ? rows.slice(0, 4).map(({ name }) => name).join(", ") + (rows.length > 4 ? ` и ещё ${rows.length - 4}` : "")
    : "никого";
  if (oldIds && difference(oldIds, nextIds, "rows")) {
    const afterLabel = people(current.rows);
    const beforeLabel = people(before!.rows);
    return `Было: ${beforeLabel}. Стало: ${afterLabel}.`;
  }
  const action = frame.step.action;
  if (action.type === "phone" || action.type === "department") {
    const person = current.rows.find(({ id }) => id === action.id);
    const old = before?.rows.find(({ id }) => id === action.id);
    const field = action.type === "phone" ? "phone" : "department";
    if (person && old && person[field] !== old[field]) {
      return `Те же сотрудники на странице. ${person.name}: ${old[field]} → ${person[field]}.`;
    }
  }
  if (before && !difference(before.rows, current.rows, output)) return `Без изменений. На странице: ${people(current.rows)}.`;
  return `На странице: ${people(current.rows)}.`;
}

function oldPaginationText(previousPages: number | undefined) {
  return previousPages ? `Список опустел · страниц ${previousPages} → 0` : "Список пуст · страниц нет";
}

export function plainEvent(event: Event) {
  switch (event.kind) {
    case "request": return `Экрану нужны данные: ${plainLabels[event.node].toLocaleLowerCase("ru-RU")}`;
    case "read": return event.node === "departments" ? "Прочитали, кто в каком отделе" : `Прочитали данные «${plainLabels[event.node]}»`;
    case "execute": return `Посчитали «${plainLabels[event.node]}»`;
    case "compare": return event.equal ? "Сравнили и вернули прежний результат" : "Сравнили и передали новый результат";
  }
}
