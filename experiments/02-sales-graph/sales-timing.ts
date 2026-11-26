import { createSalesGraph, generateSales } from "./experiment.ts";
import type { SelectionMode } from "./experiment.ts";
import { bootstrapMedianInterval, quantile } from "./timing-statistics.ts";
import { random } from "./employees/recording.ts";

export const salesTimingParameters = {
  sizes: [1_000, 10_000, 100_000],
  warmupPairs: 8,
  pairs: 40,
  groupSize: 4,
  calibrationWarmupPairs: 4,
  calibrationPairs: 3,
  targetBatchMs: 4,
  maxSalesPerMode: 600_000,
  bootstrapSeed: 144,
} as const;

export type SalesTimingTransition = { from: number; to: number };
export const defaultSalesTimingTransition: SalesTimingTransition = { from: 11, to: 12 };

type TimingPair = { normalBatchMs: number; reuseBatchMs: number };
type SalesGraph = ReturnType<typeof createSalesGraph>;
type TimingProgress = (done: number, size: number, phase: "Подбор пачки" | "Прогрев" | "Замер") => void;

function directSelection(data: readonly number[], threshold: number) {
  const selected: number[] = [];
  let sum = 0;
  for (const sale of data) {
    if (sale >= threshold) {
      selected.push(sale);
      sum += sale;
    }
  }
  return { selected, average: selected.length ? sum / selected.length : null };
}

function measureBatch(
  graphs: readonly SalesGraph[], averages: (number | null)[],
  { from, to }: SalesTimingTransition, expectedBefore: number | null, expectedAfter: number | null,
) {
  for (const graph of graphs) {
    graph.writeThreshold(from);
    if (!Object.is(graph.readAverage(), expectedBefore)) {
      throw new Error(`Среднее при пороге ${from} расходится с прямым расчётом.`);
    }
  }
  const start = performance.now();
  for (let index = 0; index < graphs.length; index++) {
    const graph = graphs[index];
    graph.writeThreshold(to);
    averages[index] = graph.readAverage();
  }
  const elapsed = performance.now() - start;
  if (!averages.every((average) => Object.is(average, expectedAfter))) {
    throw new Error(`Среднее при пороге ${to} расходится с прямым расчётом.`);
  }
  return elapsed;
}

function observedTimerStep() {
  let previous = performance.now();
  let smallest = Infinity;
  let ticks = 0;
  // Ограничиваем число чтений даже при грубом или замороженном таймере.
  for (let i = 0; i < 200_000 && ticks < 16; i++) {
    const now = performance.now();
    if (now > previous) {
      smallest = Math.min(smallest, now - previous);
      previous = now;
      ticks++;
    }
  }
  return Number.isFinite(smallest) ? smallest : null;
}

export function summarizeSalesTiming(pairs: readonly TimingPair[], batchSize: number, timerStepMs: number | null) {
  const normalMs = quantile(pairs.map((pair) => pair.normalBatchMs), .5) / batchSize;
  const reuseMs = quantile(pairs.map((pair) => pair.reuseBatchMs), .5) / batchSize;
  const differences = pairs.map((pair) => (pair.normalBatchMs - pair.reuseBatchMs) / batchSize);
  const differenceMs = quantile(differences, .5);
  const interval = bootstrapMedianInterval(differences, random(salesTimingParameters.bootstrapSeed));
  // Один шаг таймера относится ко всей пачке.
  const resolution = timerStepMs === null ? Infinity : (timerStepMs * 1.01) / batchSize;
  const insufficientPrecision = Math.min(normalMs, reuseMs, Math.abs(differenceMs)) <= resolution;
  return { normalMs, reuseMs, differenceMs, interval, insufficientPrecision };
}

export const salesTimingTotal = salesTimingParameters.sizes.length *
  (salesTimingParameters.warmupPairs + salesTimingParameters.pairs);

export async function measureSalesTiming(transition: SalesTimingTransition, progress: TimingProgress) {
  const { from, to } = transition;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("Введите два конечных числовых порога.");
  const {
    sizes, warmupPairs, pairs, groupSize,
    calibrationWarmupPairs, calibrationPairs, targetBatchMs, maxSalesPerMode,
  } = salesTimingParameters;
  const timerStepMs = observedTimerStep();
  const rows = [];
  let done = 0;
  for (const salesCount of sizes) {
    const data = generateSales(salesCount);
    const before = directSelection(data, from);
    const after = directSelection(data, to);
    const selectionChanged = before.selected.length !== after.selected.length ||
      before.selected.some((sale, index) => sale !== after.selected[index]);
    const pools: Record<SelectionMode, SalesGraph[]> = { normal: [], "reuse-array": [] };
    const averages: (number | null)[] = [];
    const limit = Math.floor(maxSalesPerMode / salesCount);
    // Ищем пачку в несколько миллисекунд даже для более быстрого режима.
    const target = Math.max(targetBatchMs, (timerStepMs ?? 0) * 12);
    let batchSize = 2;

    function measurePair(pair: number): TimingPair {
      const [first, second]: [SelectionMode, SelectionMode] = pair % 2 === 0
        ? ["normal", "reuse-array"] : ["reuse-array", "normal"];
      const firstMs = measureBatch(pools[first], averages, transition, before.average, after.average);
      const secondMs = measureBatch(pools[second], averages, transition, before.average, after.average);
      return first === "normal"
        ? { normalBatchMs: firstMs, reuseBatchMs: secondMs }
        : { normalBatchMs: secondMs, reuseBatchMs: firstMs };
    }

    const calibration = [];
    let calibrationPair = 0;
    while (true) {
      progress(done, salesCount, "Подбор пачки");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (const mode of ["normal", "reuse-array"] as const) {
        while (pools[mode].length < batchSize) pools[mode].push(createSalesGraph(mode, data));
      }
      averages.length = batchSize;
      for (let warmup = 0; warmup < calibrationWarmupPairs; warmup++) measurePair(calibrationPair++);
      const probes = Array.from({ length: calibrationPairs }, () => measurePair(calibrationPair++));
      calibration.push({ batchSize, probes });
      const fasterMedian = Math.min(
        quantile(probes.map((pair) => pair.normalBatchMs), .5),
        quantile(probes.map((pair) => pair.reuseBatchMs), .5),
      );
      if (fasterMedian >= target || batchSize === limit) break;
      batchSize = Math.min(batchSize * 2, limit);
    }

    const trials: TimingPair[] = [];
    for (let pair = -warmupPairs; pair < pairs; pair++) {
      const trial = measurePair(pair);
      if (pair >= 0) trials.push(trial);
      done++;
      if (done % groupSize === 0) {
        progress(done, salesCount, pair < 0 ? "Прогрев" : "Замер");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    rows.push({
      salesCount,
      previousSelectionCount: before.selected.length,
      selectionCount: after.selected.length,
      selectionChanged,
      previousAverage: before.average,
      average: after.average,
      batchSize,
      calibration,
      trials,
      ...summarizeSalesTiming(trials, batchSize, timerStepMs),
    });
  }
  return { timerStepMs, rows };
}

export type SalesTimingResult = Awaited<ReturnType<typeof measureSalesTiming>>;
export type SalesTimingReport = SalesTimingResult & {
  protocol: "sales-2";
  unit: "ms/operation";
  created: string;
  browser: string;
  build: string;
  signalsVersion: string;
  parameters: typeof salesTimingParameters & SalesTimingTransition;
};
