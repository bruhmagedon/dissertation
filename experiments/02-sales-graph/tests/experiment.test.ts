import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createExperiment, runScenario, snapshotFromJournal } from "../experiment.ts";
import { operationTraces, traceFrame } from "../trace.ts";

test("оба сценария сохраняют исходные результаты и реальные вызовы", () => {
  const a = runScenario("A").snapshot();
  const b = runScenario("B").snapshot();
  deepStrictEqual(a.readings, [25, 30, 35, 35]);
  deepStrictEqual(b.readings, [25, 35, 35]);
  deepStrictEqual(a.calls, { filtered: 3, sum: 3, count: 3, average: 3 });
  deepStrictEqual(b.calls, { filtered: 2, sum: 2, count: 2, average: 2 });
  for (const snapshot of [a, b]) {
    for (const node of ["filtered", "sum", "count", "average"] as const) {
      equal(
        snapshot.calls[node],
        snapshot.log.filter((entry) => entry.type === "computed" && entry.node === node).length,
      );
    }
  }
});

test("записи, снимки и повторное чтение не вызывают лишних вычислений", () => {
  const experiment = createExperiment();
  const initial = experiment.snapshot();
  experiment.execute({ type: "write", value: 20 });
  const written = experiment.execute({ type: "write", value: 30 });
  deepStrictEqual(written.calls, initial.calls);
  deepStrictEqual(written.readings, []);
  deepStrictEqual(experiment.snapshot(), written);
  const read = experiment.execute({ type: "read" });
  deepStrictEqual(read.readings, [35]);
  deepStrictEqual(read.calls, { filtered: 1, sum: 1, count: 1, average: 1 });
  experiment.execute({ type: "write", value: 30 });
  const repeated = experiment.execute({ type: "read" });
  deepStrictEqual(repeated.calls, read.calls);
  deepStrictEqual(
    repeated.log.slice(-4).map((entry) => entry.type),
    ["read", "read-start", "read-end", "result"],
  );
});

test("снимки изолированы от графа и друг от друга, просмотр истории чистый", () => {
  const experiment = runScenario("B");
  const before = experiment.snapshot();
  for (let i = 1; i <= before.log.length; i++) snapshotFromJournal(before.log.slice(0, i));
  deepStrictEqual(experiment.snapshot(), before);
  const changed = experiment.snapshot();
  changed.calls.average = 999;
  changed.log.length = 0;
  changed.readings.push(999);
  if (Array.isArray(changed.values.filtered)) changed.values.filtered.push(999);
  deepStrictEqual(experiment.snapshot(), before);
  deepStrictEqual(JSON.parse(JSON.stringify(before)), before);
});

test("пустая выборка и некорректный порог", () => {
  const experiment = createExperiment();
  throws(() => experiment.execute({ type: "write", value: NaN }), /конечным числом/);
  equal(experiment.snapshot().log.length, 1);
  experiment.execute({ type: "write", value: 50 });
  const empty = experiment.execute({ type: "read" });
  deepStrictEqual(empty.values, { filtered: [], sum: 0, count: 0, average: null });
  deepStrictEqual(empty.readings, [null]);
  deepStrictEqual(JSON.parse(JSON.stringify(empty)), empty);
});

test("первые пять обращений связаны с конкретными выполнениями и завершениями", () => {
  const experiment = createExperiment();
  const snapshot = experiment.execute({ type: "read" });
  const [trace] = operationTraces(snapshot.log);
  deepStrictEqual(
    trace.requests.map(({ from, to }) => [from, to]),
    [
      ["average", "sum"],
      ["sum", "filtered"],
      ["filtered", "threshold"],
      ["average", "count"],
      ["count", "filtered"],
    ],
  );
  deepStrictEqual(
    trace.requests.map(({ ready }) => ready),
    [false, false, false, false, true],
  );
  equal(trace.after.readings[0], 25);
  const firstSelection = trace.requests[1];
  const secondSelection = trace.requests[4];
  equal(trace.requests[2].parentId, firstSelection.id);
  equal(secondSelection.parentId, trace.requests[3].id);
  equal(
    snapshot.log.filter(
      (event) =>
        event.type === "computed" &&
        event.node === "filtered" &&
        event.requestId === firstSelection.id,
    ).length,
    1,
  );
  equal(
    snapshot.log.filter(
      (event) => event.type === "computed" && event.requestId === secondSelection.id,
    ).length,
    0,
  );
  const frames = trace.requests.map((_, step) => traceFrame(snapshot.log, trace, step));
  deepStrictEqual(
    frames.map((frame) => frame.snapshot.calls.filtered),
    [0, 0, 1, 1, 1],
  );
  deepStrictEqual(
    frames.map((frame) => frame.snapshot.calls.average),
    [0, 0, 0, 0, 1],
  );
  deepStrictEqual(frames.at(-1)?.snapshot.calls, snapshot.calls);
  deepStrictEqual(experiment.snapshot(), snapshot);
});

test("порядок обновления берётся из событий, записи и повторные чтения не выдумывают стрелки", () => {
  for (const name of ["A", "B"] as const) {
    const experiment = runScenario(name);
    const snapshot = experiment.snapshot();
    const traces = operationTraces(snapshot.log);
    const reads = traces.filter((trace) => trace.operation.type === "read");
    deepStrictEqual(
      reads.slice(0, -1).map((trace) => trace.after.calls.filtered),
      name === "A" ? [1, 2, 3] : [1, 2],
    );
    const updated = reads[1];
    deepStrictEqual(
      updated.requests.map(({ from, to }) => [from, to]),
      [
        ["filtered", "threshold"],
        ["sum", "filtered"],
        ["average", "sum"],
        ["average", "count"],
        ["count", "filtered"],
      ],
    );
    equal(updated.requests[1].ready, true);
    const repeated = reads.at(-1)!;
    equal(repeated.requests.length, 0);
    equal(repeated.after.readings.at(-1), 35);
    deepStrictEqual(repeated.after.calls, repeated.before.calls);
    for (const trace of traces) {
      if (trace.operation.type === "write") {
        equal(trace.requests.length, 0);
        deepStrictEqual(trace.after.calls, trace.before.calls);
      }
      for (let step = 0; step < trace.requests.length; step++)
        traceFrame(snapshot.log, trace, step);
    }
    deepStrictEqual(experiment.snapshot(), snapshot);
  }
});
