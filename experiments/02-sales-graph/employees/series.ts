import { diagnose } from "./diagnose.ts";
import type { DiagnosticStats } from "./diagnose.ts";
import { createEmployeeRun, engineVersions, engines, graphVariants, policies } from "./engine.ts";
import type { Engine, GraphVariant, Policy } from "./engine.ts";
import { integer, object, parseRecording } from "./import.ts";
import { random } from "./recording.ts";
import type { Recording } from "./recording.ts";

export const protocol = "employees-1";
export interface Environment { runtime: "node" | "browser"; details: string; build: string }
export interface Parameters {
  repeats: number;
  warmup: number;
  blocks: number;
  seed: number;
  threshold: number;
}
export const pilot: Parameters = { repeats: 5, warmup: 3, blocks: 4, seed: 144, threshold: 0.05 };
export const extended: Parameters = { repeats: 25, warmup: 6, blocks: 6, seed: 144, threshold: 0.05 };

interface Configuration { graph: GraphVariant; policy: Policy }
export const architectureConfigs = {
  A0: { graph: "A", policy: "baseline" },
  A1: { graph: "A", policy: "filtered" },
  B0: { graph: "B", policy: "baseline" },
  B1: { graph: "B", policy: "filtered" },
} as const satisfies Record<string, Configuration>;
export type ArchitectureId = keyof typeof architectureConfigs;
export const architectureIds = Object.keys(architectureConfigs) as ArchitectureId[];

export interface Trial<K extends string = Policy> { pair: number; order: number; policy: K; timesMs: number[] }
interface Benchmark<K extends string> {
  schema: 1;
  protocol: string;
  unit: "ms/recording";
  created: string;
  recording: Recording;
  engine: Engine;
  version: string;
  environment: Environment;
  parameters: Parameters;
  status: "partial" | "complete";
  wallMs: number;
  diagnostics: Partial<Record<K, DiagnosticStats>>;
  trials: Trial<K>[];
}
export interface Series extends Benchmark<Policy> { graph: GraphVariant }
export interface ArchitectureSeries extends Benchmark<ArchitectureId> { comparison: "architecture" }
export type Report = Series | ArchitectureSeries;
interface Options {
  signal?: AbortSignal;
  progress?: (done: number, total: number, phase: string) => void;
}

function shuffled<T>(list: readonly T[], next: () => number): T[] {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

let lastResult: ReturnType<ReturnType<typeof createEmployeeRun>["execute"]> | undefined;
function block(recording: Recording, engine: Engine, config: Configuration): number {
  const run = createEmployeeRun(recording, engine, config.policy, "timing", config.graph);
  run.execute(run.initialStep);
  const start = performance.now();
  for (const step of recording.steps) lastResult = run.execute(step);
  const elapsed = performance.now() - start;
  lastResult = undefined;
  return elapsed;
}

export async function runSeries(
  recording: Recording, engine: Engine, parameters: Parameters, environment: Environment,
  options: Options & { graph?: GraphVariant } = {},
): Promise<Series> {
  const graph = options.graph ?? "A";
  const configs = Object.fromEntries(policies.map((policy) => [policy, { graph, policy }])) as Record<Policy, Configuration>;
  const report = await measure(recording, engine, parameters, environment, configs, "baseline", options);
  return { ...report, graph };
}

export async function runArchitectureSeries(
  recording: Recording, engine: Engine, parameters: Parameters, environment: Environment, options: Options = {},
): Promise<ArchitectureSeries> {
  const report = await measure(recording, engine, parameters, environment, architectureConfigs, "A0", options, true);
  return { ...report, comparison: "architecture" };
}

async function measure<K extends string>(
  recording: Recording, engine: Engine, parameters: Parameters, environment: Environment,
  configs: Record<K, Configuration>, baseline: K, options: Options, requireAll = false,
) {
  if (!recording.steps.length) throw new Error("В записи нет действий.");
  if (!validParameters(parameters)) throw new Error("Неверные параметры серии.");
  const ids = Object.keys(configs) as K[];
  const report: Benchmark<K> = {
    schema: 1, protocol, unit: "ms/recording", created: new Date().toISOString(),
    recording, engine, version: engineVersions[engine], environment, parameters,
    status: "partial", wallMs: 0, diagnostics: {}, trials: [],
  };
  const started = performance.now();
  const finish = () => {
    report.wallMs = performance.now() - started;
    return report;
  };
  const { repeats, warmup, blocks, seed } = parameters;
  const next = random(seed);
  const validationNext = random(seed ^ 0x50e5);
  const eligible: K[] = [];
  let progress = 0;
  const total = ids.length * (1 + warmup + repeats);
  async function checkpoint(phase: string) {
    options.progress?.(progress++, total, phase);
    if (options.signal) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return options.signal?.aborted;
  }
  for (const policy of shuffled(ids, validationNext)) {
    if (await checkpoint("Проверка эталона")) return finish();
    const config = configs[policy];
    const { stats } = diagnose(recording, engine, config.policy, { retain: false, graph: config.graph });
    report.diagnostics[policy] = stats;
    if (stats.valid) eligible.push(policy);
  }
  if (!eligible.includes(baseline) || (requireAll && eligible.length !== ids.length)) return finish();
  for (let pair = -warmup; pair < repeats; pair++) {
    for (const [order, policy] of shuffled(ids.filter((item) => eligible.includes(item)), next).entries()) {
      if (await checkpoint(pair < 0 ? "Прогрев" : "Измерение")) return finish();
      const timesMs = Array.from({ length: blocks }, () => block(recording, engine, configs[policy]));
      if (pair >= 0) report.trials.push({ pair: pair + 1, order: order + 1, policy, timesMs });
    }
  }
  report.status = "complete";
  options.progress?.(total, total, "Готово");
  return finish();
}

export function quantile(values: readonly number[], fraction: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}
export function describe(values: readonly number[]) {
  return { median: quantile(values, .5), q1: quantile(values, .25), q3: quantile(values, .75) };
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeTrial<K extends string>(report: Benchmark<K>, policy: NoInfer<K>) {
  const values = report.trials.filter((trial) => trial.policy === policy).map((trial) => mean(trial.timesMs));
  return { count: values.length, ...describe(values) };
}

export function paired<K extends string>(report: Benchmark<K>, baseline: NoInfer<K>, candidate: NoInfer<K>) {
  const baselineTimes = new Map(report.trials.filter(({ policy }) => policy === baseline).map(({ pair, timesMs }) => [pair, mean(timesMs)]));
  const deltas = report.trials.flatMap(({ pair, policy, timesMs }) => {
    const before = baselineTimes.get(pair);
    return policy === candidate && before !== undefined ? [before - mean(timesMs)] : [];
  });
  const estimate = describe(deltas);
  let interval: [number, number] | undefined;
  if (deltas.length >= 12) {
    const next = random(report.parameters.seed ^ 0x6b21);
    const bootstrap = Array.from({ length: 2_000 }, () =>
      quantile(deltas.map(() => deltas[Math.floor(next() * deltas.length)]), .5));
    interval = [quantile(bootstrap, .025), quantile(bootstrap, .975)];
  }
  return { ...estimate, interval, deltas };
}

export function assessPair<K extends string>(report: Benchmark<K>, baseline: NoInfer<K>, candidate: NoInfer<K>) {
  const { interval, deltas, median } = paired(report, baseline, candidate);
  const pairs = deltas.length;
  const margin = report.parameters.threshold;
  const outcome = report.status !== "complete" || pairs < report.parameters.repeats || !interval ? "insufficient"
    : interval[0] > margin ? "faster"
    : interval[1] < -margin ? "slower"
    : interval[0] >= -margin && interval[1] <= margin ? "equivalent"
    : "uncertain";
  return { outcome, pairs, median, interval: outcome === "insufficient" ? undefined : interval } as const;
}

export type PairAssessment = ReturnType<typeof assessPair>;
export function outcomeLabel(assessment: PairAssessment) {
  switch (assessment.outcome) {
    case "insufficient": return "Недостаточно данных для вывода · " + assessment.pairs + " пар";
    case "equivalent": return "Разница в пределах заданного порога";
    case "faster": return "Различимая экономия";
    case "slower": return "Различимое замедление";
    case "uncertain": return "Результат неопределён при текущем разбросе";
  }
}

export function interpretation(report: Series, candidate: Policy) {
  return outcomeLabel(assessPair(report, "baseline", candidate));
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function validParameters(p: unknown): p is Parameters {
  return object(p) && integer(p.repeats, 1, 100) && integer(p.warmup, 0, 30) &&
    integer(p.blocks, 1, 30) && integer(p.seed, 0, 0xffffffff) && nonnegative(p.threshold);
}

function parseBenchmark<K extends string>(value: unknown, ids: readonly K[], baseline: K): Benchmark<K> {
  if (!object(value) || value.schema !== 1 || value.protocol !== protocol || value.unit !== "ms/recording") {
    throw new Error("Нужна серия версии 1 с единицей мс на запись.");
  }
  const recording = parseRecording(value.recording);
  const { engine, version, environment, parameters, status, trials, diagnostics, created } = value;
  if (!engines.some((item) => item === engine) || typeof version !== "string" ||
    typeof created !== "string" || !Number.isFinite(Date.parse(created)) || !recording.steps.length ||
    !object(environment) || (environment.runtime !== "node" && environment.runtime !== "browser") ||
    typeof environment.details !== "string" || typeof environment.build !== "string" ||
    !validParameters(parameters) || (status !== "partial" && status !== "complete") ||
    !nonnegative(value.wallMs) || !Array.isArray(trials) || !object(diagnostics)) {
    throw new Error("Паспорт серии содержит неверные параметры, среду или статус.");
  }
  const counters = ["executions", "comparisons", "summaryReads", "membershipChanges", "orderChanges"];
  for (const [policy, item] of Object.entries(diagnostics)) {
    if (!ids.some((entry) => policy === entry) || !object(item) ||
      typeof item.valid !== "boolean" || (!item.valid && typeof item.error !== "string") ||
      !counters.every((key) => integer(item[key], 0, Number.MAX_SAFE_INTEGER)) ||
      (item.byNode !== undefined && (!object(item.byNode) ||
        !Object.values(item.byNode).every((count) => integer(count, 0, Number.MAX_SAFE_INTEGER))))) {
      throw new Error("Неверная проверка эталона для политики " + policy + ".");
    }
  }
  const unique = new Set<string>();
  const positions = new Set<string>();
  for (const trial of trials) {
    if (!object(trial) || !integer(trial.pair, 1, parameters.repeats) || !integer(trial.order, 1, ids.length) ||
      typeof trial.policy !== "string" || !ids.some((item) => item === trial.policy) ||
      (diagnostics[trial.policy] as DiagnosticStats | undefined)?.valid !== true ||
      !Array.isArray(trial.timesMs) || trial.timesMs.length !== parameters.blocks || !trial.timesMs.every(nonnegative) ||
      unique.has(trial.pair + ":" + trial.policy) || positions.has(trial.pair + ":" + trial.order)) {
      throw new Error("В серии неверный или повторный результат парного повтора.");
    }
    unique.add(trial.pair + ":" + trial.policy);
    positions.add(trial.pair + ":" + trial.order);
  }
  if (status === "complete" && (Object.keys(diagnostics).length !== ids.length ||
    (diagnostics[baseline] as DiagnosticStats | undefined)?.valid !== true ||
    trials.length !== parameters.repeats * Object.values(diagnostics).filter((item) => (item as DiagnosticStats).valid).length)) {
    throw new Error("Завершённая серия содержит неполные повторы.");
  }
  return { ...value, recording } as unknown as Benchmark<K>;
}

export function parseSeries(value: unknown): Series {
  if (!object(value) || value.comparison !== undefined) throw new Error("Ожидается отчёт о политиках одного графа.");
  const graph = value.graph === undefined ? "A" : graphVariants.find((item) => item === value.graph);
  if (!graph) throw new Error("Неизвестный вариант графа.");
  return { ...parseBenchmark(value, policies, "baseline"), graph };
}

export function parseReport(value: unknown): Report {
  if (object(value) && value.comparison === "architecture") {
    const report = parseBenchmark(value, architectureIds, "A0");
    if (report.status === "complete" && architectureIds.some((id) => !report.diagnostics[id]?.valid)) {
      throw new Error("Полный архитектурный повтор требует четыре проверенные конфигурации.");
    }
    return { ...report, comparison: "architecture" };
  }
  return parseSeries(value);
}
