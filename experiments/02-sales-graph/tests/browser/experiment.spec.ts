import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { formatEntry, formatValue, scenarios } from "../../experiment.ts";
import type { Snapshot } from "../../experiment.ts";
import { computationCount } from "../../trace.ts";

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
      `${computationCount(count)} с начала прогона`,
    );
  }
  const journal = page.getByTestId("journal");
  await expect(journal.locator(".log-entry > span:last-child")).toHaveText(
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
      await page.getByRole("button", { name: `Запустить ${name}` }).click();
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
    .locator(".log-entry > span:last-child")
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
  await page.getByLabel("Фильтр журнала").selectOption("computed");
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
  await page.getByLabel("Фильтр журнала").selectOption("all");
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
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Запустить A" }).click();
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

test("первое чтение: пять обращений, общая выборка, готовый результат и завершения по шагам", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
  await page.getByRole("button", { name: "Порядок чтения", exact: true }).click();
  await expect(page.getByTestId("operation-summary")).toContainText("чтение среднего = 25");
  await expect(page.getByTestId("operation-summary")).toContainText("Вычислений: 4");
  const labels = [
    "Среднее → Сумма",
    "Сумма → Выборка",
    "Выборка → Порог",
    "Среднее → Количество",
    "Количество → Выборка: Готовый результат",
  ];
  for (let index = 0; index < labels.length; index++) {
    await expect(page.getByTestId(`request-${index + 1}`)).toHaveAttribute(
      "aria-label",
      `${index + 1}. ${labels[index]}`,
    );
  }
  await expect(page.locator('.react-flow__node[data-id="filtered"]')).toHaveCount(1);
  await expect(page.getByTestId("request-5")).toHaveAttribute("data-ready", "true");
  await expect(
    page.locator('.react-flow__edge path[id^="request-"][style*="stroke-dasharray"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("calls-filtered")).toHaveText("1 вычисление с начала прогона");
  await expect(page.getByTestId("delta-filtered")).toHaveText("+1 за эту операцию");
  mkdirSync("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/read-order-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Вместить граф" }).click();
  await page.screenshot({ path: "screenshots/read-order-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const filteredCounts = [0, 0, 1, 1, 1];
  for (let step = 0; step < 5; step++) {
    await page.getByRole("button", { name: "Вперёд", exact: true }).click();
    await expect(page.getByTestId(`request-${step + 1}`)).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("calls-filtered")).toHaveText(
      `${computationCount(filteredCounts[step])} с начала прогона`,
    );
    await expect(page.getByTestId("total-filtered")).toHaveText("1");
  }
  await expect(page.getByRole("button", { name: "Вперёд", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByTestId("reading-step")).toHaveText("Обращение 4 из 5");
  await page
    .getByTestId("journal")
    .getByRole("button", { name: /Операция: прочитать среднее/ })
    .first()
    .click();
  await expect(page.getByTestId("reading-step")).toHaveText("Операция целиком");
  await page.getByLabel("Новый порог", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(page.getByTestId("operation-summary")).toContainText("запись порога = 20");
  await expect(page.getByTestId("operation-summary")).toContainText("Вычислений: 0");
  await expect(page.locator('.react-flow__node[data-id="threshold"] .node-value')).toHaveText("20");
  await expect(page.getByTestId("delta-filtered")).toHaveText("+0 за эту операцию");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

for (const name of ["A", "B"] as const) {
  test(`история ${name}: дополнительное вычисление видно по операции, просмотр не меняет прогон`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: `Запустить ${name}` }).click();
    await page.getByRole("button", { name: "Порядок чтения", exact: true }).click();
    await expect(page.getByTestId("operation-summary")).toContainText("чтение среднего = 35");
    await expect(page.getByTestId("operation-summary")).toContainText("Вычислений: 0");
    await expect(page.getByTestId("operation-summary")).toContainText(
      "Новых обращений к зависимостям нет",
    );
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
    const reads = page
      .getByTestId("journal")
      .getByRole("button", { name: /Операция: прочитать среднее/ });
    const thresholds = name === "A" ? [10, 20, 30] : [10, 30];
    for (let index = 0; index < thresholds.length; index++) {
      await reads.nth(index).click();
      await expect(page.getByTestId("reading-step")).toHaveText("Операция целиком");
      await expect(page.locator('.react-flow__node[data-id="threshold"] .node-value')).toHaveText(
        String(thresholds[index]),
      );
      await expect(page.getByTestId("calls-filtered")).toHaveText(
        `${computationCount(index + 1)} с начала прогона`,
      );
      await expect(page.getByTestId("delta-filtered")).toHaveText("+1 за эту операцию");
      for (let step = 0; step < 5; step++)
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
    await page.mouse.move(bounds.x + bounds.width - 40, bounds.y + bounds.height - 40);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 90, bounds.y + bounds.height - 80, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(viewport).not.toHaveAttribute("style", transform!);
    await page.getByRole("button", { name: "Зависимости", exact: true }).click();
    await expectSnapshot(page, consoleResults[name]);
    // Новая команда публикует журнал заново и выявляет возможные скрытые обращения.
    await page.getByRole("button", { name: "Прочитать среднее", exact: true }).click();
    const { runScenario } = await import("../../experiment.ts");
    const expected = runScenario(name).execute({ type: "read" });
    await expectSnapshot(page, expected);
  });
}
