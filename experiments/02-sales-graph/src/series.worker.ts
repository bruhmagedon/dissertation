import { predict } from "../employees/forecast.ts";
import { diagnose, executionDelta } from "../employees/diagnose.ts";
import type { Forecast } from "../employees/forecast.ts";
import { runSeries } from "../employees/series.ts";
import type { Environment, Parameters, Series } from "../employees/series.ts";
import type { Recording } from "../employees/recording.ts";
import type { Engine, Node, Policy } from "../employees/engine.ts";

export interface Observation {
  action: number;
  policy: Policy;
  summary: boolean;
  omitted: Node[];
  added: Node[];
}

export type Request =
  | { type: "series"; recording: Recording; engine: Engine; parameters: Parameters; environment: Environment; observePolicy?: Policy }
  | { type: "forecast"; recording: Recording; engine: Engine; threshold: number }
  | { type: "cancel" };
export type Response =
  | { type: "progress"; done: number; total: number; phase: string }
  | { type: "report"; report: Series; observation?: Observation }
  | { type: "prediction"; forecast: Forecast }
  | { type: "error"; message: string };

const port = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (reply: Response) => void;
};
let ongoing: AbortController | undefined;

port.onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    ongoing?.abort();
    return;
  }
  if (ongoing) return;
  try {
    if (data.type === "forecast") {
      port.postMessage({ type: "prediction", forecast: predict(data.recording, data.engine, data.threshold) });
    } else {
      ongoing = new AbortController();
      const report = await runSeries(data.recording, data.engine, data.parameters, data.environment, {
        signal: ongoing.signal,
        progress: (done, total, phase) => port.postMessage({ type: "progress", done, total, phase }),
      });
      let observation: Observation | undefined;
      const policy = data.observePolicy;
      if (report.status === "complete" && policy && report.diagnostics[policy]?.valid) {
        const baseline = diagnose(data.recording, data.engine, "baseline");
        const candidate = policy === "baseline" ? baseline : diagnose(data.recording, data.engine, policy);
        const deltas = candidate.frames.map((frame, action) => ({
          action, policy, summary: frame.step.outputs.includes("summary"),
          ...executionDelta(baseline.frames[action], frame),
        }));
        observation = deltas.find(({ omitted, added }) => omitted.length || added.length) ?? deltas[0];
      }
      port.postMessage({ type: "report", report, observation });
    }
  } catch (error) {
    port.postMessage({ type: "error", message: (error as Error).message });
  } finally { ongoing = undefined; }
};
