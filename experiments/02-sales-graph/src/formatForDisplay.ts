import { formatEntry, formatValue } from "../experiment.ts";
import type { LogEntry, Value } from "../experiment.ts";

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function formatDisplayValue(value: Value | undefined): string {
  return typeof value === "number" ? numberFormat.format(value) : formatValue(value);
}

export function formatDisplayEntry(event: LogEntry): string {
  switch (event.type) {
    case "read-end":
      return `Ответ #${event.id}: ${formatDisplayValue(event.value)}`;
    case "value":
      return `${event.node} #${event.call} вернул ${formatDisplayValue(event.value)} (запрос #${event.requestId})`;
    case "result":
      return `Результат: ${formatDisplayValue(event.value)}`;
    case "write":
      return `Операция: записать порог = ${formatDisplayValue(event.value)}`;
    default:
      return formatEntry(event);
  }
}
