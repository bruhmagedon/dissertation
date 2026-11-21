import { readFileSync } from "node:fs";
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { compareOperations } from "../experiment.ts";
import { borisRecording, transferPair } from "../employees/conditions.ts";
import { diagnose, executionDelta } from "../employees/diagnose.ts";
import { createEmployeeRun, engines, firstMismatch, policies } from "../employees/engine.ts";
import type { Evaluation } from "../employees/engine.ts";
import { omittedExecutions, predict, validateForecast } from "../employees/forecast.ts";
import { parseRecording } from "../employees/import.ts";
import { demoRecording, makeStep, preset, sizes } from "../employees/recording.ts";
import { architectureConfigs, architectureIds, assessPair, paired, parseReport, parseSeries, pilot, runArchitectureSeries, runSeries } from "../employees/series.ts";

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
  throws(() => validateForecast(forecast, { ...report, graph: "B" }), /Граф проверочной серии/);
  equal(validateForecast(forecast, report)?.rules[0].saving.outcome, "insufficient");
});

test("перевод Бориса сохраняет строки при всех отделах и меняет отбор при включении фильтра", () => {
  const recording = borisRecording(false);
  recording.steps.push(
    makeStep({ type: "filter", department: "Продажи" }, true),
    makeStep({ type: "department", id: 9, department: "Продажи" }, true),
    makeStep({ type: "filter", department: "" }, true),
    makeStep({ type: "department", id: 9, department: "Поддержка" }, true),
  );
  for (const engine of engines) {
    const a0 = diagnose(recording, engine, "baseline", { graph: "A" });
    const a1 = diagnose(recording, engine, "filtered", { graph: "A" });
    const b0 = diagnose(recording, engine, "baseline", { graph: "B" });
    const b1 = diagnose(recording, engine, "filtered", { graph: "B" });
    for (const replay of [a0, a1, b0, b1]) {
      equal(replay.stats.valid, true, replay.stats.error);
      deepStrictEqual(replay.frames.map(({ result }) => result), a0.frames.map(({ result }) => result));
    }
    const executed = (frame: typeof a0.frames[number], node: string) => frame.evaluations.some((entry) => entry.node === node);
    ok(executed(a0.frames[2], "filtered") && executed(a0.frames[2], "sorted"));
    ok(executed(a1.frames[2], "filtered") && !executed(a1.frames[2], "sorted"));
    ok(a1.frames[2].events.some((entry) => entry.kind === "compare" && entry.node === "filtered" && entry.equal));
    ok(!executed(b0.frames[2], "filtered") && !executed(b0.frames[2], "sorted"));
    ok(!b1.frames[2].events.some((entry) => entry.kind === "compare" && entry.node === "filtered"));
    ok(executed(b0.frames[2], "summary"));
    deepStrictEqual(b0.frames[2].result.summary, [["Продажи", 1], ["Поддержка", 2]]);
    equal(b0.frames[2].result.rows.find(({ id }) => id === 9)?.department, "Поддержка");
    ok(executed(b0.frames[3], "filtered") && executed(b0.frames[4], "filtered") && executed(b0.frames[5], "filtered"));
    ok(!executed(b0.frames[6], "filtered"));
    deepStrictEqual(b0.frames[3].result.rows.map(({ id }) => id), [7]);
    deepStrictEqual(b0.frames[4].result.rows.map(({ id }) => id), [7, 9]);
    deepStrictEqual(b0.frames[4].result.summary, [["Продажи", 2]]);
    const control = diagnose(borisRecording(true), engine, "baseline", { graph: "B" });
    deepStrictEqual(control.frames[2].result.rows.map(({ id }) => id), [7]);
    ok(executed(control.frames[2], "filtered") && executed(control.frames[2], "sorted"));
  }
});

test("парные условия сохраняют переводы и проверяют собственные выходы", () => {
  const data = { kind: "generated", size: 100, seed: 42 } as const;
  for (const condition of ["summary", "filter"] as const) {
    const [left, right] = transferPair(data, condition, { summary: true, filter: "" });
    deepStrictEqual(left.steps.map(({ action }) => action), right.steps.map(({ action }) => action));
    const a = diagnose(left, "preact", "baseline", { graph: "B" });
    const b = diagnose(right, "preact", "baseline", { graph: "B" });
    ok(a.stats.valid && b.stats.valid);
    if (condition === "summary") {
      equal(a.stats.summaryReads, 0);
      equal(b.stats.summaryReads, right.steps.length);
      deepStrictEqual(a.frames.map(({ result }) => result.rows), b.frames.map(({ result }) => result.rows));
    } else {
      equal(a.stats.summaryReads, b.stats.summaryReads);
      equal(a.stats.byNode?.filtered ?? 0, 0);
      equal(b.stats.byNode?.filtered, right.steps.length);
    }
  }
});

test("единый повтор измеряет четыре конфигурации, старый отчёт использует граф A", async () => {
  const legacy: unknown = JSON.parse(readFileSync(new URL("../results/preact-editing-1000-pilot.json", import.meta.url), "utf8"));
  equal(parseSeries(legacy).graph, "A");
  const recording = borisRecording(false);
  const report = await runArchitectureSeries(recording, "reselect", { ...pilot, repeats: 2, warmup: 0, blocks: 1 },
    { runtime: "node", details: process.version, build: "test" });
  deepStrictEqual(parseReport(JSON.parse(JSON.stringify(report))), report);
  for (const pair of [1, 2]) {
    const trials = report.trials.filter((trial) => trial.pair === pair);
    deepStrictEqual(trials.map(({ policy }) => policy).sort(), ["A0", "A1", "B0", "B1"]);
    deepStrictEqual(trials.map(({ order }) => order), [1, 2, 3, 4]);
  }
  equal(assessPair(report, "A0", "B0").outcome, "insufficient");
  equal(assessPair(report, "A0", "B0").pairs, 2);
  for (const engine of engines) {
    const mixed = preset("mixed", 1_000, 42);
    for (const key of architectureIds) {
      const config = architectureConfigs[key];
      const run = diagnose(mixed, engine, config.policy, { graph: config.graph });
      ok(run.stats.valid, run.stats.error);
      equal(run.stats.executions, 64);
    }
  }
});

test("вывод различает недостаток пар, эквивалентность, знак и разброс", async () => {
  const recording = borisRecording(false);
  const report = await runSeries(recording, "preact", { ...pilot, repeats: 1, blocks: 1, warmup: 0 },
    { runtime: "node", details: process.version, build: "test" });
  report.parameters.repeats = 12;
  const baseline = Array.from({ length: 12 }, (_, index) => ({ pair: index + 1, order: 1, policy: "baseline" as const, timesMs: [10] }));
  function assessment(values: number[], status: typeof report.status = "complete") {
    return assessPair({ ...report, status, trials: [...baseline, ...values.map((value, index) => ({
      pair: index + 1, order: 2, policy: "filtered" as const, timesMs: [value],
    }))] }, "baseline", "filtered");
  }
  equal(assessment([9]).outcome, "insufficient");
  equal(assessment(Array(12).fill(9), "partial").outcome, "insufficient");
  equal(assessment(Array(12).fill(9.99)).outcome, "equivalent");
  equal(assessment(Array(12).fill(9)).outcome, "faster");
  equal(assessment(Array(12).fill(11)).outcome, "slower");
  equal(assessment([...Array(6).fill(9), ...Array(6).fill(11)]).outcome, "uncertain");
});
