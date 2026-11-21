import { createEmployeeRun, firstMismatch } from "./engine.ts";
import type { DependencyGraph, Engine, Frame, Policy } from "./engine.ts";
import { createOracle, difference } from "./oracle.ts";
import type { Recording } from "./recording.ts";

export interface DiagnosticStats {
  executions: number;
  comparisons: number;
  summaryReads: number;
  membershipChanges: number;
  orderChanges: number;
  valid: boolean;
  error?: string;
}
export interface Diagnostic { graph: DependencyGraph; initial: Frame; frames: Frame[]; stats: DiagnosticStats }

export function diagnose(
  recording: Recording, engine: Engine, policy: Policy,
  options: { retain?: boolean; calibrate?: boolean } = {},
): Diagnostic {
  const run = createEmployeeRun(recording, engine, policy, options.calibrate ? "calibration" : "diagnostic");
  const oracle = createOracle(recording);
  const stats: DiagnosticStats = {
    executions: 0, comparisons: 0, summaryReads: 0, membershipChanges: 0, orderChanges: 0, valid: true,
  };
  const frames: Frame[] = [];
  let previous: number[] | undefined;
  function check(frame: Frame, index: number) {
    const expected = oracle.calculate(frame.step);
    let first: string | undefined;
    for (const output of frame.step.outputs) {
      first = difference(expected.result[output], frame.result[output], output);
      if (first) break;
    }
    first ??= difference(expected.orderedIds, frame.orderedIds, "sorted");
    if (first && stats.valid) {
      stats.valid = false;
      stats.error = (index === 0 ? "Первое чтение" : "Действие №" + index) + " · " + first;
    }
    if (index > 0 && previous) {
      stats.executions += frame.evaluations.length;
      stats.comparisons += frame.events.filter((event) => event.kind === "compare").length;
      stats.summaryReads += Number(frame.step.outputs.includes("summary"));
      if (firstMismatch("filtered", previous, expected.orderedIds) !== expected.orderedIds.length) {
        const before = new Set(previous);
        if (before.size !== expected.orderedIds.length || expected.orderedIds.some((id) => !before.has(id))) {
          stats.membershipChanges++;
        } else stats.orderChanges++;
      }
    }
    previous = expected.orderedIds;
  }
  const initial = run.capture(run.initialStep);
  check(initial, 0);
  for (const [i, step] of recording.steps.entries()) {
    const frame = run.capture(step);
    check(frame, i + 1);
    if (options.retain !== false) frames.push(frame);
  }
  return { graph: run.graph, initial, frames, stats };
}

export function executionDelta(base: Frame, candidate: Frame) {
  const omitted = new Set(base.evaluations.map(({ node }) => node));
  const added = new Set(candidate.evaluations.map(({ node }) => node));
  for (const { node } of base.evaluations) {
    if (added.delete(node)) omitted.delete(node);
  }
  return { omitted: [...omitted], added: [...added] };
}
