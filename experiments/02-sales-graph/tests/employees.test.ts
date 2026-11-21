import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { compareOperations } from "../experiment.ts";
import { diagnose, executionDelta } from "../employees/diagnose.ts";
import { createEmployeeRun, engines, firstMismatch, policies } from "../employees/engine.ts";
import type { Evaluation } from "../employees/engine.ts";
import { omittedExecutions, predict, validateForecast } from "../employees/forecast.ts";
import { parseRecording } from "../employees/import.ts";
import { demoRecording, makeStep, preset, sizes } from "../employees/recording.ts";
import { paired, parseSeries, pilot, runSeries } from "../employees/series.ts";

test("контрольные продажи дают 3/1 при прежнем составе и 4/4 при новом", () => {
  for (const [start, end, expected] of [[11, 12, [3, 1]], [10, 11, [4, 4]]] as const) {
    const runs = compareOperations([{ type: "write", value: start }, { type: "read" }, { type: "write", value: end }, { type: "read" }], 4);
    deepStrictEqual(runs.map(({ snapshot }) =>
      snapshot.log.slice(snapshot.log.findLastIndex(({ type }) => type === "read")).filter(({ type }) => type === "computed").length),
    expected);
  }
});

test("демонстрация обновляет телефон, отдел, сводку и равные по длине выборки во всех режимах", () => {
  const recording = demoRecording();
  for (const engine of engines) {
    const baseline = diagnose(recording, engine, "baseline");
    for (const policy of policies) {
      const run = diagnose(recording, engine, policy);
      equal(run.stats.valid, true, run.stats.error);
      deepStrictEqual(run.frames.map(({ result }) => result), baseline.frames.map(({ result }) => result));
      deepStrictEqual(run.frames[1].result.summary, [["Продажи", 2], ["Поддержка", 1]]);
      deepStrictEqual(run.frames[2].result.summary, [["Продажи", 1], ["Поддержка", 2]]);
      equal(run.frames[1].result.rows[0].phone, "+7 900 111-11-11");
      deepStrictEqual(run.frames.map(({ result }) => result.rows.map(({ id }) => id)), [[7, 9], [7, 9], [7, 9], [9, 15]]);
      equal(run.initial.events.some(({ node }) => node === "summary"), false);
    }
    const filtered = diagnose(recording, engine, "filtered");
    ok(executionDelta(baseline.frames[2], filtered.frames[2]).omitted.includes("sorted"));
    equal(filtered.frames[2].evaluations.some(({ node }) => node === "summary"), true);
    equal(filtered.frames[2].evaluations.some(({ node }) => node === "rows"), true);
  }
});

test("перестановка ID, пустая страница, повторное чтение и независимые кеши", () => {
  equal(firstMismatch("pageIds", [7, 9], [9, 7]), 0);
  equal(firstMismatch("filtered", [7, 9], [9, 15]), 0);
  const recording = demoRecording();
  recording.steps = [
    makeStep({ type: "page", page: 99 }, false),
    makeStep({ type: "sort", sort: "name-desc" }, false),
    makeStep({ type: "search", query: "Нет такого имени" }, false),
    makeStep({ type: "read" }, false),
  ];
  for (const engine of engines) {
    const first = diagnose(recording, engine, "pageIds");
    const second = diagnose(recording, engine, "pageIds");
    deepStrictEqual(first.frames, second.frames);
    equal(first.stats.valid, true, first.stats.error);
    equal(first.stats.orderChanges, 1);
    deepStrictEqual(first.frames[0].result.pagination, { total: 3, pages: 2, page: 1 });
    deepStrictEqual(first.frames[2].result, { rows: [], pagination: { total: 0, pages: 0, page: 0 } });
    equal(first.frames[3].evaluations.length, 0);
    equal(first.frames[3].events.some(({ node }) => node === "summary"), false);
    const timed = createEmployeeRun(recording, engine, "pageIds", "timing");
    timed.execute(timed.initialStep);
    deepStrictEqual(recording.steps.map(timed.execute), first.frames.map(({ result }) => result));
  }
});

test("записи всех размеров воспроизводятся и проходят независимый эталон", () => {
  for (const size of sizes) {
    const recording = preset("mixed", size, 42);
    const copy = parseRecording(JSON.parse(JSON.stringify(recording)));
    deepStrictEqual(copy, recording);
    for (const engine of engines) {
      const { stats } = diagnose(copy, engine, "filtered", { retain: false });
      equal(stats.valid, true, stats.error);
      ok(stats.summaryReads > 0 && stats.summaryReads < recording.steps.length);
    }
  }
  const broken = demoRecording();
  broken.steps[1].outputs.pop();
  throws(() => parseRecording(broken), /выходы действия №2/);
  throws(() => parseRecording({ schema: 99 }), /версия записи 1/);
});

test("в ромбе экономия на общем потомке считается один раз и учитывает другую изменившуюся зависимость", () => {
  const events: Evaluation[] = [
    { node: "filtered", changed: ["filter"], comparison: { equal: true, measure: () => true } },
    { node: "sorted", changed: ["filtered"] },
    { node: "pageIds", changed: ["filtered"] },
    { node: "rows", changed: ["sorted", "pageIds"] },
  ];
  deepStrictEqual(omittedExecutions(events, "filtered"), ["sorted", "pageIds", "rows"]);
  events[3].changed.push("phones");
  deepStrictEqual(omittedExecutions(events, "filtered"), ["sorted", "pageIds"]);
  events[0].comparison!.equal = false;
  deepStrictEqual(omittedExecutions(events, "filtered"), []);
});

test("серия сохраняет пары и частичные результаты, прогноз проверяется на другой записи", async () => {
  const recording = preset("editing", 100, 42);
  const parameters = { ...pilot, repeats: 2, warmup: 1, blocks: 1 };
  const environment = { runtime: "node", details: process.version, build: "tests" } as const;
  const forecast = predict(recording, "preact", parameters.threshold);
  equal(forecast.estimates.length, 3);
  const validation = preset("editing", 100, 42, 1);
  const report = await runSeries(validation, "preact", parameters, environment);
  equal(report.status, "complete");
  equal(report.trials.length, 8);
  deepStrictEqual(parseSeries(JSON.parse(JSON.stringify(report))), report);
  equal(paired(report, "baseline", "pageIds").deltas.length, 2);
  equal(validateForecast(forecast, report)?.rules.length, 4);
  throws(() => validateForecast(forecast, { ...report, recording }), /другая запись/);
  const controller = new AbortController();
  const partial = await runSeries(validation, "preact", parameters, environment, {
    signal: controller.signal,
    progress: (done) => { if (done === 9) controller.abort(); },
  });
  equal(partial.status, "partial");
  equal(partial.trials.length, 1);
  deepStrictEqual(parseSeries(JSON.parse(JSON.stringify(partial))), partial);
  const bad = structuredClone(report);
  bad.trials[1] = bad.trials[0];
  throws(() => parseSeries(bad), /повторный результат/);
});
