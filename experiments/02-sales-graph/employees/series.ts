import { diagnose } from "./diagnose.ts";
import type { DiagnosticStats } from "./diagnose.ts";
import { createEmployeeRun, engineVersions, engines, policies } from "./engine.ts";
import type { Engine, Policy } from "./engine.ts";
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

export interface Trial { pair: number; order: number; policy: Policy; timesMs: number[] }
export interface Series {
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
  diagnostics: Partial<Record<Policy, DiagnosticStats>>;
  trials: Trial[];
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
function block(recording: Recording, engine: Engine, policy: Policy): number {
  const run = createEmployeeRun(recording, engine, policy, "timing");
  run.execute(run.initialStep);
  const start = performance.now();
  for (const step of recording.steps) lastResult = run.execute(step);
  const elapsed = performance.now() - start;
  lastResult = undefined;
  return elapsed;
}

export async function runSeries(
  recording: Recording, engine: Engine, parameters: Parameters, environment: Environment,
  options: { signal?: AbortSignal; progress?: (done: number, total: number, phase: string) => void } = {},
): Promise<Series> {
  if (!recording.steps.length) throw new Error("В записи нет действий.");
  if (!validParameters(parameters)) throw new Error("Неверные параметры серии.");
  const report: Series = {
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
  const eligible: Policy[] = [];
  let progress = 0;
  const total = policies.length * (1 + warmup + repeats);
  async function checkpoint(phase: string) {
    options.progress?.(progress++, total, phase);
    if (options.signal) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return options.signal?.aborted;
  }
  for (const policy of shuffled(policies, validationNext)) {
    if (await checkpoint("Проверка эталона")) return finish();
    const { stats } = diagnose(recording, engine, policy, { retain: false });
    report.diagnostics[policy] = stats;
    if (stats.valid) eligible.push(policy);
  }
  if (!eligible.includes("baseline")) return finish();
  for (let pair = -warmup; pair < repeats; pair++) {
    for (const [order, policy] of shuffled(policies.filter((item) => eligible.includes(item)), next).entries()) {
      if (await checkpoint(pair < 0 ? "Прогрев" : "Измерение")) return finish();
      const timesMs = Array.from({ length: blocks }, () => block(recording, engine, policy));
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

export function summarizeTrial(report: Series, policy: Policy) {
  const values = report.trials.filter((trial) => trial.policy === policy).map((trial) => mean(trial.timesMs));
  return { count: values.length, ...describe(values) };
}

export function paired(report: Series, baseline: Policy, candidate: Policy) {
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

export function interpretation(report: Series, candidate: Policy) {
  const { interval, deltas } = paired(report, "baseline", candidate);
  const margin = report.parameters.threshold;
  if (!deltas.length) return "Нет пар";
  if (!interval) return "Пилот · мало пар для интервала";
  if (interval[0] > margin) return "Различимая экономия";
  if (interval[1] < -margin) return "Различимое замедление";
  if (interval[0] >= -margin && interval[1] <= margin) return "Разница меньше порога";
  return "Эффект неразличим";
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function validParameters(p: unknown): p is Parameters {
  return object(p) && integer(p.repeats, 1, 100) && integer(p.warmup, 0, 30) &&
    integer(p.blocks, 1, 30) && integer(p.seed, 0, 0xffffffff) && nonnegative(p.threshold);
}

export function parseSeries(value: unknown): Series {
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
    if (!policies.some((entry) => policy === entry) || !object(item) ||
      typeof item.valid !== "boolean" || (!item.valid && typeof item.error !== "string") ||
      !counters.every((key) => integer(item[key], 0, Number.MAX_SAFE_INTEGER))) {
      throw new Error("Неверная проверка эталона для политики " + policy + ".");
    }
  }
  const unique = new Set<string>();
  const positions = new Set<string>();
  for (const trial of trials) {
    if (!object(trial) || !integer(trial.pair, 1, parameters.repeats) || !integer(trial.order, 1, policies.length) ||
      typeof trial.policy !== "string" || !policies.some((item) => item === trial.policy) ||
      (diagnostics[trial.policy] as DiagnosticStats | undefined)?.valid !== true ||
      !Array.isArray(trial.timesMs) || trial.timesMs.length !== parameters.blocks || !trial.timesMs.every(nonnegative) ||
      unique.has(trial.pair + ":" + trial.policy) || positions.has(trial.pair + ":" + trial.order)) {
      throw new Error("В серии неверный или повторный результат парного повтора.");
    }
    unique.add(trial.pair + ":" + trial.policy);
    positions.add(trial.pair + ":" + trial.order);
  }
  if (status === "complete" && (Object.keys(diagnostics).length !== policies.length ||
    (diagnostics.baseline as DiagnosticStats | undefined)?.valid !== true ||
    trials.length !== parameters.repeats * Object.values(diagnostics).filter((item) => (item as DiagnosticStats).valid).length)) {
    throw new Error("Завершённая серия содержит неполные повторы.");
  }
  return { ...value, recording } as unknown as Series;
}
