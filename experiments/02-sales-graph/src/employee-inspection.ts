import type { DependencyGraph, Engine, Frame, Policy } from "../employees/engine.ts";
import type { Recording } from "../employees/recording.ts";

export interface Inspection {
  recording: Recording;
  engine: Engine;
  graph: DependencyGraph;
  policy: Policy;
  primary: Frame[];
  compare?: Frame[];
  action: number;
  back: "employees" | "research";
}
