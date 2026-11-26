import { measureSalesTiming } from "../sales-timing.ts";
import type { SalesTimingResult, SalesTimingTransition } from "../sales-timing.ts";

export type SalesTimingMessage =
  | { type: "progress"; done: number; size: number; phase: "Подбор пачки" | "Прогрев" | "Замер" }
  | { type: "result"; result: SalesTimingResult }
  | { type: "error"; message: string };

const port = self as unknown as {
  onmessage: ((event: MessageEvent<SalesTimingTransition>) => Promise<void>) | null;
  postMessage: (message: SalesTimingMessage) => void;
};

port.onmessage = async ({ data }) => {
  try {
    const result = await measureSalesTiming(data, (done, size, phase) =>
      port.postMessage({ type: "progress", done, size, phase }));
    port.postMessage({ type: "result", result });
  } catch (error) {
    port.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
