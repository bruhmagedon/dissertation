import { computed, signal } from "@preact/signals-core";

const count = signal(1);
const doubled = computed(() => {
  console.log("Пересчёт");
  return count.value * 2;
});

console.log("Шаг 1. Первое чтение doubled");
console.log("doubled =", doubled.value);

console.log("\nШаг 2. Запись count = 2, затем count = 3");
// Между записями не читаем doubled, чтобы не влиять на вычисление.
count.value = 2;
count.value = 3;

console.log("\nШаг 3. Чтение doubled после записей");
console.log("doubled =", doubled.value);

console.log("\nШаг 4. Повторное чтение без изменений");
console.log("doubled =", doubled.value);
