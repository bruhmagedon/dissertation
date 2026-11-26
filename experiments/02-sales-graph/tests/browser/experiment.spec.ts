import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { formatEntry, formatValue, scenarios } from "../../experiment.ts";
import type { Snapshot } from "../../experiment.ts";
import { computationCount, operationSteps, operationTraces } from "../../trace.ts";

// Запускаем настоящий консольный entrypoint отдельным процессом.
const consoleResults = JSON.parse(
  execFileSync(process.execPath, ["script.ts", "--json"], { encoding: "utf8" }),
) as Record<"A" | "B", Snapshot>;

async function expectSnapshot(page: Page, expected: Snapshot) {
  await expect(page.getByTestId("readings")).toHaveText(
    expected.readings.map(formatValue).join(" → "),
  );
  for (const [node, count] of Object.entries(expected.calls)) {
    await expect(page.getByTestId(`total-${node}`)).toHaveText(String(count));
    await expect(page.getByTestId(`calls-${node}`)).toHaveText(
      new RegExp(`^×${count} всего`),
    );
  }
  const journal = page.getByTestId("journal");
  await expect(journal.locator(".journal-event-text")).toHaveText(
    expected.log.map(formatEntry),
  );
}

for (const name of ["A", "B"] as const) {
  test(`ручные действия ${name} совпадают с консолью`, async ({ page }) => {
    await page.goto("/");
    for (const node of ["filtered", "sum", "count", "average"]) {
      await expect(page.getByTestId(`total-${node}`)).toHaveText("0");
    }
    for (const operation of scenarios[name]) {
      if (operation.type === "read")
        await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
      else {
        const counts = await page.getByRole("table").locator("tbody td").allTextContents();
        await page.getByLabel("Новый порог", { exact: true }).fill(String(operation.value));
        await page.getByRole("button", { name: "Записать", exact: true }).click();
        await expect(page.getByRole("table").locator("tbody td")).toHaveText(counts);
      }
    }
    await expectSnapshot(page, consoleResults[name]);
  });

  test(`готовый сценарий ${name} совпадает с консолью и каждый раз создаёт свежий граф`, async ({
    page,
  }) => {
    await page.goto("/");
    for (let run = 0; run < 2; run++) {
      await page.getByRole("button", { name: `Запустить сценарий ${name}` }).click();
      await expectSnapshot(page, consoleResults[name]);
    }
  });
}

test("панорамирование, масштаб, просмотр и экспорт журнала при непрочитанном пороге не вычисляют граф", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  for (const value of [20, 30]) {
    await page.getByLabel("Новый порог", { exact: true }).fill(String(value));
    await page.getByRole("button", { name: "Записать", exact: true }).click();
  }
  const counts = await page.getByRole("table").locator("tbody td").allTextContents();
  const log = await page.getByTestId("journal").locator(".log-entry").allTextContents();
  const exportedEntries = await page
    .getByTestId("journal")
    .locator(".journal-event-text")
    .allTextContents();
  const viewport = page.locator(".react-flow__viewport");
  const transform = await viewport.getAttribute("style");
  const bounds = await page.getByTestId("graph").boundingBox();
  if (!bounds) throw new Error("Холст не найден");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + 70, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("style", transform!);
  await page.getByRole("button", { name: "Увеличить граф" }).click();
  await page.getByRole("button", { name: "Вместить граф" }).click();
  await page.setViewportSize({ width: 1100, height: 900 });
  const journal = page.getByTestId("journal");
  await journal.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => journal.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByLabel("Фильтр журнала").click();
  await page.getByRole("option", { name: "Вызовы computed", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать TXT" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("reactivity-journal.txt");
  const file = await download.path();
  expect(file).not.toBeNull();
  expect(readFileSync(file!, "utf8")).toBe(exportedEntries.join("\n") + "\n");
  await journal.getByRole("button").last().click();
  await expect(page.getByLabel("Снимок события")).toContainText("После события");
  await page.getByRole("button", { name: "Закрыть снимок" }).click();
  await page.getByLabel("Фильтр журнала").click();
  await page.getByRole("option", { name: "Все события", exact: true }).click();
  await expect(page.getByRole("table").locator("tbody td")).toHaveText(counts);
  await expect(journal.locator(".log-entry")).toHaveText(log);
  // Явное чтение публикует новый снимок и выявило бы скрытые вызовы при просмотре.
  await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  await expectSnapshot(page, consoleResults.B);
});

test("пустая выборка, сброс и мобильная ширина", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Новый порог", { exact: true }).fill("");
  await expect(page.getByRole("button", { name: "Записать", exact: true })).toBeDisabled();
  await page.getByLabel("Новый порог", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  await expect(page.getByTestId("readings")).toHaveText("Нет продаж");
  await page.getByRole("button", { name: "Начать с чистого графа" }).click();
  await expect(page.getByTestId("total-average")).toHaveText("0");
  await expect(page.getByTestId("readings")).toContainText("Ещё нет");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("снимки интерфейса и отсутствие ошибок браузера", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const write = page.getByRole("button", { name: "Записать", exact: true });
  const read = page.getByRole("button", { name: "Прочитать среднее" });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(write).toBeInViewport({ ratio: 1 });
  await expect(read).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(write).toBeInViewport({ ratio: 1 });
  await expect(read).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Запустить сценарий A" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  await expect(page.locator(".react-flow__nodes")).toBeVisible();
  mkdirSync("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const graph = await page.getByTestId("graph").boundingBox();
      const lastNode = await page.locator('.react-flow__node[data-id="average"]').boundingBox();
      return !!graph && !!lastNode && lastNode.x + lastNode.width <= graph.x + graph.width;
    })
    .toBe(true);
  await page.screenshot({ path: "screenshots/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("первое чтение: шесть карточек, две выборки и связи по родителям", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  await page.getByRole("button", { name: "Порядок чтения", exact: true }).click();
  await expect(page.getByTestId("operation-summary")).toContainText("чтение среднего = 25");
  await expect(page.getByTestId("summary-filtered")).toContainText(
    "2 записанных чтения · 1 вычисление за операцию · 1 вычисление с начала прогона",
  );
  const cards = page.getByTestId("request-card");
  await expect(cards).toHaveCount(6);
  const labels = ["Среднее", "Сумма", "Выборка", "Порог", "Количество", "Выборка"];
  const values = ["25", "100", "[10, 20, 30, 40]", "10", "4", "[10, 20, 30, 40]"];
  const coordinates = [];
  for (let index = 0; index < labels.length; index++) {
    const node = page.locator(`.react-flow__node[data-id="${index + 1}"]`);
    await expect(node.getByTestId("request-card")).toHaveAttribute(
      "data-request-id",
      String(index + 1),
    );
    await expect(node).toContainText(labels[index]);
    await expect(node.locator(".request-card-result")).toHaveText(values[index]);
    coordinates.push(await node.evaluate((element) => element.style.transform));
  }
  const positions = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      page.locator(`.react-flow__node[data-id="${i + 1}"]`).boundingBox(),
    ),
  );
  for (let index = 1; index < positions.length; index++)
    expect(positions[index]!.y).toBeGreaterThan(positions[index - 1]!.y);
  expect(positions[1]!.x).toBeGreaterThan(positions[0]!.x);
  expect(positions[2]!.x).toBeGreaterThan(positions[1]!.x);
  expect(positions[3]!.x).toBeGreaterThan(positions[2]!.x);
  expect(Math.abs(positions[4]!.x - positions[1]!.x)).toBeLessThan(1);
  expect(Math.abs(positions[5]!.x - positions[2]!.x)).toBeLessThan(1);
  await expect(page.locator('.react-flow__node[data-id="3"]')).toContainText("Вычислилось");
  await expect(page.locator('.react-flow__node[data-id="3"]')).toContainText("+1 вычисление");
  await expect(page.locator('.react-flow__node[data-id="4"]')).toContainText("Прочитали сигнал");
  await expect(page.locator('.react-flow__node[data-id="6"]')).toContainText("Готовое значение");
  await expect(page.locator('.react-flow__node[data-id="6"]')).toContainText("+0 вычислений");
  await expect(page.getByTestId("edge-5")).toHaveAttribute("data-source", "1");
  await expect(page.getByTestId("edge-6")).toHaveAttribute("data-source", "5");
  await expect(page.getByTestId("edge-6")).toHaveCSS("stroke-dasharray", "6px, 4px");
  mkdirSync("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/read-tree-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Вместить граф" }).click();
  await page.screenshot({ path: "screenshots/read-tree-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "Вместить граф" }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
  const initialViewport = await page.locator(".react-flow__viewport").getAttribute("style");
  const trace = operationTraces(consoleResults.A.log)[0];
  const steps = operationSteps(consoleResults.A.log, trace);
  const filteredEnd = trace.timeline[2].end;
  for (let step = 0; step < steps.length; step++) {
    await page.getByRole("button", { name: "Вперёд", exact: true }).click();
    const visible = trace.timeline.filter(({ start }) => start <= steps[step].start).length;
    await expect(page.locator(".react-flow__node:visible")).toHaveCount(visible);
    await expect(page.getByTestId("total-filtered")).toHaveText("1");
    await expect(page.locator(".react-flow__viewport")).toHaveAttribute("style", initialViewport!);
    for (let index = 0; index < visible; index++) {
      await expect.poll(() => page.locator(`.react-flow__node[data-id="${index + 1}"]`)
        .evaluate((element) => element.style.transform)).toBe(coordinates[index]);
    }
    if (visible >= 3) {
      const filterCard = page.locator('.react-flow__node[data-id="3"]');
      if (steps[step].start < filteredEnd) {
        await expect(filterCard.locator(".request-card-result")).toHaveText("Ожидает завершения");
        await expect(page.getByTestId("summary-filtered")).toContainText("0 вычислений за операцию");
      } else {
        await expect(filterCard).toContainText("+1 вычисление");
        await expect(page.getByTestId("summary-filtered")).toContainText("1 вычисление за операцию");
      }
    }
    if (step === 0) {
      await expect(page.getByTestId("operation-summary")).not.toContainText("= 25");
      await expect(page.getByTestId("operation-summary")).toContainText("Вычислений: 0");
    }
  }
  await expect(page.locator('.react-flow__node[data-id="6"]')).toContainText("+0 вычислений");
  await expect(page.getByRole("button", { name: "Вперёд", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByTestId("reading-step")).toHaveAttribute("aria-label", `Шаг ${steps.length - 1} из ${steps.length}`);
  await page
    .getByTestId("journal")
    .getByRole("button", { name: /Операция: прочитать среднее/ })
    .first()
    .click();
  await expect(page.getByTestId("reading-step")).toHaveAttribute("aria-label", "Операция целиком");
  await page.getByLabel("Новый порог", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(page.getByTestId("operation-summary")).toContainText("запись порога = 20");
  await expect(page.getByTestId("request-card")).toContainText("Запись порога");
  await expect(page.getByTestId("request-card")).toContainText("20");
  await expect(page.getByTestId("request-card")).toContainText("0 вычислений");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

for (const name of ["A", "B"] as const) {
  test(`история ${name}: проверки и обращения не меняют прогон`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: `Запустить сценарий ${name}` }).click();
    await page.getByRole("button", { name: "Порядок чтения", exact: true }).click();
    await expect(page.getByTestId("operation-summary")).toContainText("чтение среднего = 35");
    await expect(page.getByTestId("operation-summary")).toContainText("Вычислений: 0");
    await expect(page.getByTestId("request-card")).toHaveCount(1);
    await expect(page.getByTestId("request-card")).toContainText("Среднее");
    await expect(page.getByTestId("request-card")).toContainText("35");
    await expect(page.getByTestId("request-card")).toContainText("Готовое значение");
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
    const reads = page
      .getByTestId("journal")
      .getByRole("button", { name: /Операция: прочитать среднее/ });
    const traces = operationTraces(consoleResults[name].log).filter(
      (trace) => trace.operation.type === "read",
    );
    const thresholds = name === "A" ? [10, 20, 30] : [10, 30];
    for (let index = 0; index < thresholds.length; index++) {
      await reads.nth(index).click();
      await expect(page.getByTestId("reading-step")).toHaveAttribute("aria-label", "Операция целиком");
      const threshold = page.locator('[data-testid="request-card"][data-node="threshold"]');
      await expect(threshold).toContainText(String(thresholds[index]));
      await expect(page.getByTestId("summary-filtered")).toContainText(
        `${computationCount(index + 1)} с начала прогона`,
      );
      await expect(page.getByTestId("summary-filtered")).toContainText("1 вычисление за операцию");
      if (index > 0) {
        const validation = page.locator(
          '[data-testid="request-card"][data-kind="validation"][data-node="filtered"]',
        );
        await expect(validation).toContainText("Проверка зависимости");
        await expect(validation).toContainText("+1 вычисление");
        const thresholdId = traces[index].timeline.find((item) => item.node === "threshold")!.id;
        const validationId = traces[index].timeline.find(
          (item) => item.node === "filtered" && item.kind === "validation",
        )!.id;
        await expect(page.getByTestId(`edge-${thresholdId}`)).toHaveAttribute(
          "data-source",
          validationId,
        );
      }
      for (let step = 0; step < traces[index].timeline.length; step++)
        await page.getByRole("button", { name: "Вперёд", exact: true }).click();
      await page.getByRole("button", { name: "Назад", exact: true }).click();
      await page.getByRole("button", { name: "Зависимости", exact: true }).click();
      await page.getByRole("button", { name: "Порядок чтения", exact: true }).click();
    }
    const graph = page.getByTestId("graph");
    await graph.scrollIntoViewIfNeeded();
    const bounds = await graph.boundingBox();
    if (!bounds) throw new Error("Холст не найден");
    const viewport = page.locator(".react-flow__viewport");
    const transform = await viewport.getAttribute("style");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + 60, { steps: 6 });
    await page.mouse.up();
    await expect(viewport).not.toHaveAttribute("style", transform!);
    await page.getByRole("button", { name: "Зависимости", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    await expectSnapshot(page, consoleResults[name]);
    await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
    const { runScenario } = await import("../../experiment.ts");
    const expected = runScenario(name).execute({ type: "read" });
    await expectSnapshot(page, expected);
  });
}

test("замер продаж обновляет три размера и сохраняет переход из сравнения на полотно", async ({ page }) => {
  await page.goto("/");
  const openComparison = page.getByRole("button", { name: "Сравнить прогоны" });
  const dialog = page.getByRole("dialog", { name: "Сравнить прогоны" });
  const startTiming = dialog.getByRole("button", { name: "Замерить время" });
  await openComparison.click();
  await expect(startTiming).toBeEnabled();
  await dialog.getByRole("button", { name: "Закрыть сравнение" }).click();

  for (const threshold of [11, 12]) {
    await page.getByLabel("Новый порог", { exact: true }).fill(String(threshold));
    await page.getByRole("button", { name: "Записать", exact: true }).click();
    await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  }
  const readings = await page.getByTestId("readings").innerText();
  const events = await page.getByTestId("journal").locator(".journal-event-text").allTextContents();
  await openComparison.click();
  await dialog.getByRole("button", { name: /^1\s000$/ }).click();
  await dialog.getByRole("button", { name: "Запустить сравнение" }).click();
  await expect(dialog.getByText(/На втором чтении: 3 → 1 вычисление/)).toBeVisible();
  const timing = dialog.getByRole("table", { name: "Результаты замера времени" });
  const initialThreshold = dialog.getByLabel("Исходный порог");
  const nextThreshold = dialog.getByLabel("Новый порог");
  await expect(initialThreshold).toHaveValue("11");
  await expect(nextThreshold).toHaveValue("12");
  for (const from of [11, 10]) {
    const to = from + 1;
    await initialThreshold.fill("");
    await expect(startTiming).toBeDisabled();
    await initialThreshold.fill(String(from));
    await nextThreshold.fill(String(to));
    await startTiming.click();
    await expect(dialog.getByRole("progressbar", { name: "Ход замера времени" })).toBeVisible();
    await expect(timing.locator("tbody tr")).toHaveCount(3, { timeout: 15_000 });
    await expect(timing.getByRole("rowheader")).toHaveText([
      /^1\s000\s*Пачка: \d+ · 40 пар$/,
      /^10\s000\s*Пачка: \d+ · 40 пар$/,
      /^100\s000\s*Пачка: [2-6] · 40 пар$/,
    ]);
    await expect(dialog.getByRole("status")).toContainText(`Пороги ${from} → ${to}. 40 пар`);
    await expect(timing.locator("tbody tr").first().locator("td").first()).toHaveText(
      from === 11 ? /999 → 999\s*Состав сохранился/ : /1\s000 → 999\s*Состав изменился/,
    );
    await expect(dialog.getByText(/На втором чтении: 3 → 1 вычисление/)).toBeVisible();
  }
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Скачать замер JSON" }).click();
  const path = await (await downloadPromise).path();
  expect(path).toBeTruthy();
  const report = JSON.parse(readFileSync(path!, "utf8"));
  expect(report.parameters).toMatchObject({ from: 10, to: 11 });
  expect(report.rows.map(({ previousSelectionCount, selectionCount }: {
    previousSelectionCount: number; selectionCount: number;
  }) => [previousSelectionCount, selectionCount])).toEqual([
    [1_000, 999], [10_000, 9_999], [100_000, 99_999],
  ]);
  await dialog.getByRole("button", { name: "Закрыть сравнение" }).click();
  await expect(page.getByTestId("readings")).toHaveText(readings);
  await expect(page.getByTestId("journal").locator(".journal-event-text")).toHaveText(events);
  await openComparison.click();
  await dialog.getByRole("region", { name: "Переиспользование массива" })
    .getByRole("button", { name: /^4\. Прочитать среднее/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("operation-summary")).toContainText("Вычислений: 1");
});
