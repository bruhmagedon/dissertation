import { diagnose } from "../employees/diagnose.ts";
import type { DependencyGraph, Engine, Frame, GraphVariant, Policy } from "../employees/engine.ts";
import type { Recording } from "../employees/recording.ts";
import { architectureConfigs } from "../employees/series.ts";
import type { ArchitectureId } from "../employees/series.ts";

export interface InspectionTrace {
  graph: DependencyGraph;
  variant?: GraphVariant;
  policy: Policy;
  primary: Frame[];
  initial?: Frame;
  title?: string;
}

export interface Inspection extends InspectionTrace {
  recording: Recording;
  engine: Engine;
  compare?: Frame[];
  baseInitial?: Frame;
  alternatives?: InspectionTrace[];
  action: number;
  back: "employees" | "research";
}

export function inspectArchitectures(
  recording: Recording, engine: Engine, ids: readonly ArchitectureId[], back: Inspection["back"], action: number,
): Inspection {
  const [first, ...alternatives] = ids.map((id): InspectionTrace => {
    const { graph: variant, policy } = architectureConfigs[id];
    const { graph, initial, frames, stats } = diagnose(recording, engine, policy, { graph: variant });
    if (!stats.valid) throw new Error(stats.error);
    return { graph, variant, policy, primary: frames, initial, title: id };
  });
  return { ...first, alternatives, action, back, recording, engine };
}

export const architectureNames: Record<ArchitectureId, string> = {
  A0: "Общий отбор",
  A1: "Общий отбор с проверкой списка",
  B0: "Отбор учитывает только активный фильтр",
  B1: "Активный фильтр с проверкой списка",
};

export function inspectionTitle(title: string) {
  return Object.hasOwn(architectureNames, title)
    ? title + " · " + architectureNames[title as ArchitectureId]
    : title;
}
