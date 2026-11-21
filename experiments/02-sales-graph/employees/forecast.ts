import { diagnose } from "./diagnose.ts";
import { candidates, engineVersions, policies } from "./engine.ts";
import type { Candidate, DependencyGraph, Engine, Evaluation, GraphVariant, Node, NodeId, Policy } from "./engine.ts";
import type { Recording } from "./recording.ts";
import { assessPair, summarizeTrial } from "./series.ts";
import type { Series } from "./series.ts";

export function omittedExecutions(evaluations: readonly Evaluation[], candidate: Candidate): Node[] {
  const unchanged = new Set<NodeId>();
  const omitted = new Set<Node>();
  // Функции наблюдаются после чтения аргументов, поэтому топологический порядок уже соблюдён.
  for (const event of evaluations) {
    if (event.node === candidate && event.comparison?.equal) {
      unchanged.add(candidate);
    } else if (event.changed.length && event.changed.every((dependency) => unchanged.has(dependency))) {
      omitted.add(event.node);
      unchanged.add(event.node);
    }
  }
  return [...omitted];
}

function descendants(graph: DependencyGraph, origin: Candidate) {
  const reached = new Set<NodeId>([origin]);
  // Узлы зарегистрированы в порядке зависимостей.
  for (const [node, dependencies] of Object.entries(graph)) {
    if (dependencies.some((dependency) => reached.has(dependency))) reached.add(node as Node);
  }
  return reached.size - 1;
}

let calibrationValue: unknown;
function cost(run: () => unknown, repetitions: number) {
  calibrationValue = run();
  const start = performance.now();
  for (let i = 0; i < repetitions; i++) calibrationValue = run();
  const elapsed = (performance.now() - start) / repetitions;
  calibrationValue = undefined;
  return elapsed;
}

export interface Explanation {
  action: number;
  equal: boolean | null;
  omitted: Node[];
  compareMs: number;
  savedMs: number;
}
interface Estimate {
  policy: Candidate;
  score: number;
  matches: number;
  checks: number;
  descendants: number;
  actions: Explanation[];
}
export const ruleLabels = {
  baseline: "Базовая",
  frequency: "Доля совпадений",
  descendants: "Число потомков",
  model: "Оценка затрат",
};
type Rule = keyof typeof ruleLabels;
export interface Forecast {
  recording: Recording;
  engine: Engine;
  graph: GraphVariant;
  version: string;
  created: string;
  threshold: number;
  repetitions: number;
  profilingMs: number;
  calibrationMs: number;
  estimates: Estimate[];
  rules: Record<Rule, Policy>;
}

export function predict(recording: Recording, engine: Engine, threshold: number, graph: GraphVariant = "A"): Forecast {
  if (!recording.steps.length) throw new Error("Для прогноза нужна запись с действиями.");
  const start = performance.now();
  const diagnostic = diagnose(recording, engine, "baseline", { calibrate: true, graph });
  const profilingMs = performance.now() - start;
  if (!diagnostic.stats.valid) throw new Error(diagnostic.stats.error);
  const calibrationStarted = performance.now();
  const repetitions = 24;
  const estimates: Estimate[] = candidates.map((policy) => ({
    policy, score: 0, matches: 0, checks: 0, descendants: descendants(diagnostic.graph, policy), actions: [],
  }));
  for (const [index, frame] of diagnostic.frames.entries()) {
    const functions = new Map(frame.evaluations.filter(({ compute }) => compute).map(({ node, compute }) => [node, compute!]));
    const prices = new Map<Node, number>();
    for (const estimate of estimates) {
      const comparison = frame.evaluations.find(({ node }) => node === estimate.policy)?.comparison;
      const omitted = comparison?.equal ? omittedExecutions(frame.evaluations, estimate.policy) : [];
      let savedMs = 0;
      for (const node of omitted) {
        if (!prices.has(node)) prices.set(node, cost(functions.get(node)!, repetitions));
        savedMs += prices.get(node)!;
      }
      const compareMs = comparison ? cost(comparison.measure, repetitions * 4) : 0;
      estimate.matches += Number(comparison?.equal ?? false);
      estimate.checks += Number(comparison !== undefined);
      estimate.score += savedMs - compareMs;
      estimate.actions.push({ action: index, equal: comparison?.equal ?? null, omitted, compareMs, savedMs });
    }
  }
  const calibrationMs = performance.now() - calibrationStarted;
  // При равенстве сохраняется порядок объявления кандидатов. Нулевой результат оставляет baseline.
  const ranked = (score: (estimate: Estimate) => number) =>
    estimates.reduce((best, next) => score(next) > score(best) ? next : best);
  const frequency = ranked((item) => item.checks ? item.matches / item.checks : 0);
  const model = ranked((item) => item.score);
  return {
    recording, engine, graph, version: engineVersions[engine], created: new Date().toISOString(),
    threshold, repetitions, profilingMs, calibrationMs, estimates,
    rules: {
      baseline: "baseline",
      frequency: frequency.matches > 0 ? frequency.policy : "baseline",
      descendants: ranked((item) => item.descendants).policy,
      model: model.score > threshold ? model.policy : "baseline",
    },
  };
}

export function validateForecast(forecast: Forecast, report: Series) {
  if ((forecast.graph ?? "A") !== report.graph) throw new Error("Граф проверочной серии отличается от графа прогноза.");
  if (forecast.engine !== report.engine || forecast.version !== report.version ||
    forecast.threshold !== report.parameters.threshold ||
    JSON.stringify(forecast.recording.data) !== JSON.stringify(report.recording.data) ||
    JSON.stringify(forecast.recording.steps) === JSON.stringify(report.recording.steps)) {
    throw new Error("Для проверки нужна другая запись на том же наборе, движке и пороге.");
  }
  const ranked = policies.map((policy) => ({ policy, ...summarizeTrial(report, policy) }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => a.median - b.median);
  const measured = ranked[0]?.policy;
  const againstMinimum = measured && policies.map((policy) => ({ policy, ...assessPair(report, policy, measured) }));
  const rules = (Object.keys(ruleLabels) as Rule[]).map((rule) => {
    const policy = forecast.rules[rule];
    const saving = assessPair(report, "baseline", policy);
    const cost = measured ? assessPair(report, policy, measured) : undefined;
    return { rule, policy, saving, cost };
  });
  return { measured, againstMinimum, rules };
}
