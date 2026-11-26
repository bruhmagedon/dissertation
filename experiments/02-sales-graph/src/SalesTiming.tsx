import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultSalesTimingTransition, salesTimingParameters, salesTimingTotal } from "../sales-timing.ts";
import type { SalesTimingReport } from "../sales-timing.ts";
import type { SalesTimingMessage } from "./sales-timing.worker.ts";
import { downloadJson } from "./recording-files.ts";

const integer = new Intl.NumberFormat("ru-RU");
const timeDigits = { minimumFractionDigits: 3, maximumFractionDigits: 6 };
const milliseconds = new Intl.NumberFormat("ru-RU", timeDigits);
const difference = new Intl.NumberFormat("ru-RU", { ...timeDigits, signDisplay: "exceptZero" });

type TimingState =
  | { type: "idle" }
  | { type: "running"; done: number; label: string }
  | { type: "result"; report: SalesTimingReport }
  | { type: "error"; message: string };

export function SalesTiming() {
  const workerRef = useRef<Worker | null>(null);
  const [fromDraft, setFromDraft] = useState(String(defaultSalesTimingTransition.from));
  const [toDraft, setToDraft] = useState(String(defaultSalesTimingTransition.to));
  const [state, setState] = useState<TimingState>({ type: "idle" });
  useEffect(() => () => workerRef.current?.terminate(), []);

  const from = Number(fromDraft);
  const to = Number(toDraft);
  const validThresholds = fromDraft.trim() !== "" && toDraft.trim() !== "" &&
    Number.isFinite(from) && Number.isFinite(to);

  function startTiming() {
    if (!validThresholds || workerRef.current) return;
    const transition = { from, to };
    setState({ type: "running", done: 0, label: "Подготовка" });
    try {
      const worker = new Worker(new URL("./sales-timing.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      function finish(next: TimingState) {
        worker.terminate();
        workerRef.current = null;
        setState(next);
      }
      worker.onmessage = ({ data }: MessageEvent<SalesTimingMessage>) => {
        if (data.type === "progress") {
          setState({ type: "running", done: data.done, label: data.phase + " · " + integer.format(data.size) + " продаж" });
        } else if (data.type === "error") {
          finish(data);
        } else {
          finish({ type: "result", report: {
            ...data.result,
            protocol: "sales-2",
            unit: "ms/operation",
            created: new Date().toISOString(),
            browser: navigator.userAgent,
            build: import.meta.env.MODE + " · " + import.meta.env.VITE_SALES_TIMING_BUILD,
            signalsVersion: import.meta.env.VITE_SALES_SIGNALS_VERSION,
            parameters: { ...salesTimingParameters, ...transition },
          } });
        }
      };
      worker.onerror = () => finish({ type: "error", message: "Не удалось выполнить замер в браузерном воркере." });
      worker.postMessage(transition);
    } catch (error) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setState({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <section className="sales-timing" aria-labelledby="sales-timing-title">
      <h2 id="sales-timing-title">Время операции</h2>
      <p>Стенд читает среднее при исходном пороге, затем замеряет запись нового порога и чтение среднего.</p>
      <form className="lab-controls sales-timing-actions" onSubmit={(event) => {
        event.preventDefault();
        startTiming();
      }}>
        <label>Исходный порог
          <Input className="w-28" type="number" step="any" value={fromDraft} disabled={state.type === "running"}
            onChange={(event) => setFromDraft(event.target.value)} />
        </label>
        <label>Новый порог
          <Input className="w-28" type="number" step="any" value={toDraft} disabled={state.type === "running"}
            onChange={(event) => setToDraft(event.target.value)} />
        </label>
        <Button type="submit" variant="outline" disabled={!validThresholds || state.type === "running"}>Замерить время</Button>
        {state.type === "result" && <Button type="button" variant="outline"
          onClick={() => downloadJson("sales-timing.json", state.report)}>Скачать замер JSON</Button>}
      </form>
      {state.type === "running" && (
        <div className="lab-progress" role="status">
          <progress aria-label="Ход замера времени" value={state.done} max={salesTimingTotal} />
          <span>{state.label} · {state.done} из {salesTimingTotal} пар с учётом прогрева</span>
        </div>
      )}
      {state.type === "error" && <p role="alert" className="lab-error">{state.message}</p>}
      {state.type === "result" && (
        <>
          <p role="status">Замер завершён. Пороги {state.report.parameters.from} → {state.report.parameters.to}. {state.report.parameters.pairs} пар на размер.</p>
          <p id="sales-timing-method">Медианы в миллисекундах на один переход. Время пачки делится на число переходов. Разница рассчитана внутри каждой пары. Плюс означает экономию при переиспользовании.</p>
          <div className="lab-table-scroll" role="region" aria-label="Таблица замера времени" tabIndex={0}>
            <table className="comparison-table sales-timing-table" aria-label="Результаты замера времени" aria-describedby="sales-timing-method">
              <thead><tr>
                <th scope="col">Продаж</th><th scope="col">В выборке до → после</th>
                <th scope="col">Обычная выборка, мс</th><th scope="col">Переиспользование массива, мс</th>
                <th scope="col">Обычная − переиспользование, мс</th>
              </tr></thead>
              <tbody>{state.report.rows.map((row) => {
                const includesZero = row.interval && row.interval[0] <= 0 && row.interval[1] >= 0;
                return <tr key={row.salesCount}>
                  <th scope="row">{integer.format(row.salesCount)}<small>Пачка: {integer.format(row.batchSize)} · {row.trials.length} пар</small></th>
                  <td>
                    {integer.format(row.previousSelectionCount)} → {integer.format(row.selectionCount)}
                    <small>{row.selectionChanged ? "Состав изменился" : "Состав сохранился"}</small>
                  </td>
                  <td>{milliseconds.format(row.normalMs)}</td>
                  <td>{milliseconds.format(row.reuseMs)}</td>
                  <td>
                    <strong>{difference.format(row.differenceMs)}</strong>
                    {row.interval && <small>95% интервал: [{difference.format(row.interval[0])} … {difference.format(row.interval[1])}]</small>}
                    {includesZero && <small>Разница не различима</small>}
                    {row.insufficientPrecision && <small>Недостаточная точность таймера</small>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p>Минимальный наблюдавшийся шаг таймера: {state.report.timerStepMs === null
            ? "определить не удалось"
            : milliseconds.format(state.report.timerStepMs) + " мс на всю пачку"}.</p>
        </>
      )}
    </section>
  );
}
