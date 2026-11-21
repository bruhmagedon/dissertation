import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { diagnose, executionDelta } from "../employees/diagnose.ts";
import { engineLabels, engines, engineVersions, graphLabels, graphVariants, labels, policyLabels } from "../employees/engine.ts";
import type { Engine, GraphVariant, Policy } from "../employees/engine.ts";
import { ruleLabels, validateForecast } from "../employees/forecast.ts";
import type { Forecast } from "../employees/forecast.ts";
import { parseRecording } from "../employees/import.ts";
import { demoRecording, describeAction, makeStep, preset, profileLabels, sizes } from "../employees/recording.ts";
import type { Profile, Recording, Size } from "../employees/recording.ts";
import { extended, outcomeLabel, parseReport, pilot, protocol } from "../employees/series.ts";
import type { Environment, Report, Series } from "../employees/series.ts";
import { inspectArchitectures } from "./employee-inspection.ts";
import type { Inspection } from "./employee-inspection.ts";
import { ArchitectureResults } from "./ArchitectureResults.tsx";
import { TransferConditions } from "./TransferConditions.tsx";
import { downloadJson, savedRecording } from "./recording-files.ts";
import { dataLabel, EffectChart, ms, SeriesResults } from "./SeriesResults.tsx";
import type { Observation, Request, Response } from "./series.worker.ts";

type Work = "pilot" | "extended" | "forecast" | "validate";
type Source = Profile | "demo" | "custom";

function environment(): Environment {
  return {
    runtime: "browser",
    details: navigator.userAgent + " · " + navigator.hardwareConcurrency + " логических процессоров",
    build: protocol + " · " + import.meta.env.MODE + " · " + import.meta.env.VITE_LAB_BUILD,
  };
}

function heldOut(forecast: Forecast, profile: Profile | "same"): Recording {
  const { data, profile: original } = forecast.recording;
  if (data.kind === "generated") {
    const selected = profile === "same" ? original === "custom" || original === "demo" ? "mixed" : original : profile;
    return preset(selected, data.size, data.seed, 1);
  }
  return {
    ...demoRecording(), name: "Разбор по шагам · проверка",
    steps: [
      makeStep({ type: "phone", id: 9, phone: "+7 900 222-22-22" }, false),
      makeStep({ type: "sort", sort: "name-desc" }, false),
      makeStep({ type: "summary", open: true }, false),
      makeStep({ type: "department", id: 7, department: "Поддержка" }, true),
      makeStep({ type: "summary", open: false }, true),
      makeStep({ type: "filter", department: "Поддержка" }, false),
    ],
  };
}

function strongestEstimate(forecast: Forecast) {
  return forecast.estimates.reduce((best, current) => current.score > best.score ? current : best);
}

export function Research({ incoming, onInspect }: { incoming: Recording | undefined; onInspect: (item: Inspection) => void }) {
  const [source, setSource] = useState<Source>("editing");
  const [custom, setCustom] = useState(savedRecording);
  const [size, setSize] = useState<Size>(100);
  const [seed, setSeed] = useState("42");
  const [engine, setEngine] = useState<Engine>("preact");
  const [graph, setGraph] = useState<GraphVariant>("A");
  const [comparison, setComparison] = useState<"policies" | "architecture">("policies");
  const [threshold, setThreshold] = useState(String(pilot.threshold));
  const [busy, setBusy] = useState<Work>();
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 1, phase: "" });
  const [error, setError] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report>();
  const [forecast, setForecast] = useState<Forecast>();
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [validation, setValidation] = useState<Series>();
  const [observation, setObservation] = useState<Observation>();
  const [holdout, setHoldout] = useState<Recording>();
  const [validationProfile, setValidationProfile] = useState<Profile | "same">("same");
  const [validationExtended, setValidationExtended] = useState(false);
  const [sampleAction, setSampleAction] = useState<number>();
  const worker = useRef<Worker | null>(null);
  const interpretation = useMemo(() => forecast && validation ? validateForecast(forecast, validation) : undefined, [forecast, validation]);

  useEffect(() => {
    if (incoming) { setCustom(incoming); setSource("custom"); }
  }, [incoming]);
  useEffect(() => () => { worker.current?.terminate(); }, []);

  function recording() {
    if (source === "demo") return demoRecording();
    if (source === "custom" && custom) return custom;
    if (source === "custom") throw new Error("Сначала импортируйте запись.");
    const number = Number(seed);
    if (!seed.trim() || !Number.isInteger(number) || number < 0 || number > 0xffffffff) {
      throw new Error("Seed должен быть целым числом от 0 до 4294967295.");
    }
    return preset(source, size, number);
  }

  function remember(report: Report) {
    setReports((previous) => [...previous.filter((item) => item !== report), report]);
    setSelected(report);
  }

  function start(work: Work) {
    if (worker.current) return;
    setError("");
    try {
      const margin = work === "validate" && forecast ? forecast.threshold : Number(threshold.replace(",", "."));
      if ((work !== "validate" && !threshold.trim()) || !Number.isFinite(margin) || margin < 0) throw new Error("Практический порог должен быть числом от нуля.");
      const source = work === "validate" && forecast ? holdout ?? heldOut(forecast, validationProfile) : recording();
      if (!source.steps.length) throw new Error("В записи ещё нет действий.");
      if (work === "validate" && forecast) {
        if (JSON.stringify(forecast.recording.data) !== JSON.stringify(source.data)) throw new Error("Проверочная запись должна использовать тот же набор и seed.");
        if (JSON.stringify(forecast.recording.steps) === JSON.stringify(source.steps)) throw new Error("Выберите другую последовательность действий.");
        setValidation(undefined);
        setObservation(undefined);
      }
      const targetEngine = work === "validate" && forecast ? forecast.engine : engine;
      const targetGraph = work === "validate" && forecast ? forecast.graph : graph;
      const task: Request = work === "forecast"
        ? { type: "forecast", recording: source, engine: targetEngine, graph: targetGraph, threshold: margin }
        : {
        type: work !== "validate" && comparison === "architecture" ? "architecture" : "series",
        recording: source, engine: targetEngine, graph: targetGraph, environment: environment(),
        observePolicy: work === "validate" ? forecast?.rules.model : undefined,
        parameters: { ...(work === "extended" || (work === "validate" && validationExtended) ? extended : pilot), threshold: margin },
      };
      const active = new Worker(new URL("./series.worker.ts", import.meta.url), { type: "module" });
      worker.current = active;
      setBusy(work);
      setCancelling(false);
      setProgress({ done: 0, total: 1, phase: work === "forecast" ? "Профилирование и калибровка" : "Подготовка серии" });
      const finish = () => {
        active.terminate();
        worker.current = null;
        setBusy(undefined);
        setCancelling(false);
      };
      active.onerror = ({ message }) => { setError(message || "Ошибка измерительного процесса."); finish(); };
      active.onmessage = ({ data }: MessageEvent<Response>) => {
        if (data.type === "progress") {
          setProgress(data);
          return;
        }
        if (data.type === "report") {
          remember(data.report);
          if (work === "validate" && !("comparison" in data.report)) {
            setValidation(data.report);
            setObservation(data.observation);
          }
        }
        if (data.type === "prediction") {
          const prediction = data.forecast;
          setForecast(prediction);
          setForecasts((previous) => [...previous, prediction]);
          setHoldout(undefined);
          setValidationProfile("same");
          setValidation(undefined);
          const actions = strongestEstimate(prediction).actions;
          setSampleAction(actions?.reduce((best, entry) => entry.savedMs - entry.compareMs > best.savedMs - best.compareMs ? entry : best).action);
        }
        if (data.type === "error") setError(data.message);
        finish();
      };
      active.postMessage(task);
    } catch (issue) { setError((issue as Error).message); }
  }

  async function importFile(file: File, kind: "source" | "validation" | "series") {
    try {
      const json: unknown = JSON.parse(await file.text());
      if (kind === "series") remember(parseReport(json));
      else if (kind === "validation") setHoldout(parseRecording(json));
      else { setCustom(parseRecording(json)); setSource("custom"); }
      setError("");
    } catch (issue) {
      setError("Импорт: " + (issue as Error).message);
    }
  }

  function inspect(recording: Recording, currentEngine: Engine, variant: GraphVariant, policy: Policy, selectedAction?: number) {
    try {
      const current = diagnose(recording, currentEngine, policy, { graph: variant });
      const base = policy === "baseline" ? undefined : diagnose(recording, currentEngine, "baseline", { graph: variant });
      if (!current.stats.valid || (base && !base.stats.valid)) throw new Error(current.stats.error ?? base?.stats.error);
      const difference = base && current.frames.findIndex((frame, index) => {
        const delta = executionDelta(base.frames[index], frame);
        return delta.omitted.length || delta.added.length;
      });
      onInspect({
        recording, engine: currentEngine, policy, variant, graph: current.graph, primary: current.frames, compare: base?.frames,
        action: selectedAction ?? Math.max(0, difference ?? 0), back: "research",
      });
    } catch (issue) { setError((issue as Error).message); }
  }

  const other = forecast && forecasts.findLast((item) => item.engine !== forecast.engine &&
    item.graph === forecast.graph && item.threshold === forecast.threshold && JSON.stringify(item.recording) === JSON.stringify(forecast.recording));
  const estimate = forecast?.estimates.find((item) => item.policy === forecast.rules.model);
  const explainedCandidate = forecast && strongestEstimate(forecast);
  const explanation = sampleAction === undefined ? undefined : explainedCandidate?.actions[sampleAction];

  return <main className="lab-page">
    <header className="lab-page-head">
      <div><h1>Исследование</h1><p>Две архитектуры отбора и проверки равенства на одной записи</p></div>
      <label className="lab-upload">Импорт серии<input aria-label="Импорт серии" type="file" accept=".json,application/json" disabled={!!busy}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file, "series"); event.target.value = ""; }} /></label>
    </header>

    <section className="lab-card">
      <h2>Конфигурация</h2>
      <fieldset className="lab-controls research-config" disabled={!!busy}>
        <label>Запись<NativeSelect aria-label="Запись" value={source} onChange={(event) => setSource(event.target.value as Source)}>
          {Object.entries(profileLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          <option value="demo">Разбор по шагам</option>{custom && <option value="custom">{custom.name}</option>}
        </NativeSelect></label>
        {source !== "custom" && source !== "demo" && <>
          <label>Сотрудников<NativeSelect aria-label="Сотрудников" value={size} onChange={(event) => setSize(Number(event.target.value) as Size)}>{sizes.map((item) => <option key={item}>{item}</option>)}</NativeSelect></label>
          <label>Seed<Input className="lab-number" type="number" min="0" step="1" value={seed} onChange={(event) => setSeed(event.target.value)} /></label>
        </>}
        <label>Движок<NativeSelect aria-label="Движок" value={engine} onChange={(event) => setEngine(event.target.value as Engine)}>
          {engines.map((entry) => <option key={entry} value={entry}>{engineLabels[entry]}</option>)}
        </NativeSelect></label>
        <label>Эксперимент<NativeSelect aria-label="Эксперимент" value={comparison} onChange={(event) => setComparison(event.target.value as typeof comparison)}>
          <option value="policies">Политики одного графа</option><option value="architecture">Архитектуры A и B</option>
        </NativeSelect></label>
        <label>Граф для политик и прогноза<NativeSelect aria-label="Граф для политик и прогноза" value={graph} onChange={(event) => setGraph(event.target.value as GraphVariant)}>
          {graphVariants.map((item) => <option key={item} value={item}>{item} · {graphLabels[item]}</option>)}
        </NativeSelect></label>
        <label>Порог, мс<Input className="lab-number" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
        <label className="lab-upload">Импорт записи<input aria-label="Импорт записи для исследования" type="file" accept=".json,application/json"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file, "source"); event.target.value = ""; }} /></label>
      </fieldset>
      <div className="lab-controls">
        <Button disabled={!!busy} onClick={() => start("pilot")}>Запустить пилот</Button>
        <Button variant="outline" disabled={!!busy} onClick={() => start("extended")}>Расширенная серия</Button>
        {busy && busy !== "forecast" && <Button variant="outline" disabled={cancelling} onClick={() => {
          setCancelling(true); worker.current?.postMessage({ type: "cancel" } satisfies Request);
        }}>Отменить серию</Button>}
      </div>
      {busy && <div role="status" className="lab-progress">
        <progress aria-label="Прогресс серии" value={progress.done} max={progress.total} />
        {cancelling ? "Отмена после текущего блока" : progress.phase}
      </div>}
      {error && <p role="alert" className="lab-error">{error}</p>}
      {!busy && !selected && <p className="lab-footnote">Пилот выполняет 5 парных повторов на свежих графах в браузерном воркере.</p>}
    </section>

    {selected && <>
      <label className="series-picker">Показанная серия<NativeSelect aria-label="Показанная серия" value={reports.indexOf(selected)} onChange={(event) => setSelected(reports[Number(event.target.value)])}>
        {reports.map((item, index) => <option key={index} value={index}>{item.recording.name} · {dataLabel(item.recording)} · {engineLabels[item.engine]} · {"comparison" in item ? "A0/A1/B0/B1" : "граф " + item.graph} · {item.environment.runtime} · {item.created.slice(11, 19)}</option>)}
      </NativeSelect></label>
      {"comparison" in selected ? <ArchitectureResults report={selected} onInspect={(id) => {
        if (selected.version !== engineVersions[selected.engine]) {
          setError("Для восстановления трассы нужна версия движка из паспорта серии.");
          return;
        }
        try {
          const ids = [id, ...(["A0", "A1", "B0", "B1"] as const).filter((entry) => entry !== id)] as const;
          onInspect(inspectArchitectures(selected.recording, selected.engine, ids, "research", 0));
        } catch (issue) { setError((issue as Error).message); }
      }} /> : <>
        <SeriesResults report={selected} onInspect={(report, policy) => {
          if (report.version !== engineVersions[report.engine]) setError("Для восстановления трассы нужна версия движка из паспорта серии.");
          else inspect(report.recording, report.engine, report.graph, policy);
        }} />
        <EffectChart reports={reports.filter((item): item is Series => !("comparison" in item))} selected={selected} />
      </>}
    </>}

    <TransferConditions data={() => recording().data} engine={engine} graph={graph} onInspect={onInspect} />

    <section className="lab-card forecast-card">
      <div className="lab-section-head">
        <h2>Прогноз и проверка</h2>
        <Button disabled={!!busy} onClick={() => start("forecast")}>Получить прогноз</Button>
      </div>
      {!forecast && <p>Сначала зафиксируйте выбор на калибровочной записи. Проверочная запись будет доступна после прогноза.</p>}
      {forecast && <>
        <p className="forecast-choice"><strong>{policyLabels[forecast.rules.model]}</strong> · {engineLabels[forecast.engine]} · граф {forecast.graph} · {graphLabels[forecast.graph]} · {forecast.recording.name} · {dataLabel(forecast.recording)} · порог {ms(forecast.threshold)} мс</p>
        <p>{estimate ? "Оценка экономии " + ms(estimate.score) + " мс на калибровочную запись." : "Оценки кандидатов не превысили практический порог."}
          {" "}Профилирование {ms(forecast.profilingMs)} мс · калибровка и расчёт {ms(forecast.calibrationMs)} мс.</p>
        <div className="lab-table-scroll"><table className="lab-table">
          <thead><tr><th>Кандидат</th><th>Совпало / проверено</th><th>Потомки</th><th>Цена проверок, мс</th><th>Экономия, мс</th></tr></thead>
          <tbody>{forecast.estimates.map((item) => <tr key={item.policy}><th>{policyLabels[item.policy]}</th>
            <td>{item.matches} / {item.checks}</td><td>{item.descendants}</td>
            <td>{ms(item.actions.reduce((sum, action) => sum + action.compareMs, 0))}</td><td>{ms(item.score)}</td></tr>)}</tbody>
        </table></div>
        {explanation && explainedCandidate && <p>«{policyLabels[explainedCandidate.policy]}» · действие {explanation.action + 1} · {describeAction(forecast.recording.steps[explanation.action].action)}.
          {" "}{explanation.equal === null ? "Проверка не оценивалась." : explanation.equal ? "Результат совпал." : "Результат изменился."}
          {" "}{explanation.omitted.length ? "Можно пропустить: " + explanation.omitted.map((node) => labels[node]).join(", ") + "." : "Пропущенных функций модель не ожидает."}
          {" "}Оценка проверки {ms(explanation.compareMs)} мс.</p>}
        {other && <p>{engineLabels[other.engine]} предложил «{policyLabels[other.rules.model]}». {other.rules.model === forecast.rules.model ? "Рекомендации совпали." : "Рекомендации различаются."}</p>}
        <p className="lab-footnote">Оценка приближённая. Она использует только выполненные функции и изменения их аргументов, без затрат на обход зависимостей, кеши движка и аллокации обёрток.</p>
        <div className="lab-controls">
          <Button variant="outline" onClick={() => inspect(forecast.recording, forecast.engine, forecast.graph, explainedCandidate?.policy ?? forecast.rules.model, sampleAction)}>Разобрать прогноз на полотне</Button>
          <Button variant="outline" onClick={() => downloadJson("employee-forecast.json", forecast)}>Скачать прогноз</Button>
        </div>
        <div className="lab-controls validation-controls">
          {forecast.recording.data.kind === "generated" && <label>Проверочный профиль
            <NativeSelect aria-label="Проверочный профиль" value={validationProfile} disabled={!!holdout || !!busy} onChange={(event) => setValidationProfile(event.target.value as typeof validationProfile)}>
              <option value="same">{forecast.recording.profile === "custom" ? "Смешанная работа" : "Другая запись того же профиля"}</option>
              {Object.entries(profileLabels).map(([key, name]) => <option key={key} value={key}>{name} · перенос профиля</option>)}
            </NativeSelect>
          </label>}
          <label className="lab-upload">{holdout?.name || "Импорт проверочной записи"}<input aria-label="Импорт проверочной записи" type="file" accept=".json,application/json" disabled={!!busy}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file, "validation"); event.target.value = ""; }} /></label>
          {holdout && <Button variant="outline" disabled={!!busy} onClick={() => setHoldout(undefined)}>Использовать пресет</Button>}
          <label className="lab-checkbox"><input type="checkbox" checked={validationExtended} disabled={!!busy}
            onChange={(event) => setValidationExtended(event.target.checked)} /> Расширенная проверка</label>
          <Button disabled={!!busy} onClick={() => start("validate")}>Проверить прогноз</Button>
        </div>
        {validation && <div className="forecast-validation">
          <h3>Проверочная запись · {validation.recording.name}</h3>
          <p>Граф {validation.graph}. {validation.status === "partial" && "Серия прервана. "}
            {interpretation?.measured && "Минимальная наблюдавшаяся медиана — «" + policyLabels[interpretation.measured] + "»."}</p>
          {interpretation && <div className="lab-table-scroll"><table className="lab-table">
            <thead><tr><th>Правило</th><th>Выбор</th><th>База − выбор, мс</th><th>Цена выбора, мс</th></tr></thead>
            <tbody>{interpretation.rules.map((item) => <tr key={item.rule}>
              <th scope="row">{ruleLabels[item.rule]}</th><td>{policyLabels[item.policy]}</td>
              <td>{ms(item.saving.median)}
                {item.saving.interval && <small className="lab-subline">95% [{ms(item.saving.interval[0])}; {ms(item.saving.interval[1])}]</small>}
                <small className="lab-subline">{outcomeLabel(item.saving)}</small>
              </td>
              <td>{item.cost ? <>
                {ms(item.cost.median)}
                {item.cost.interval && <small className="lab-subline">95% [{ms(item.cost.interval[0])}; {ms(item.cost.interval[1])}]</small>}
                <small className="lab-subline">{item.cost.outcome === "faster" ? "Выбор дороже" :
                  item.cost.outcome === "slower" ? "Выбор дешевле по парным разницам" : outcomeLabel(item.cost)}</small>
              </> : outcomeLabel(item.saving)}</td>
            </tr>)}</tbody>
          </table></div>}
          <p className="lab-footnote">Цена — медиана парных разниц «выбранная политика минус политика с минимальной наблюдавшейся медианой». Короткий пилот служит описательным ориентиром.</p>
          {observation && <p>Действие {observation.action + 1} · {describeAction(validation.recording.steps[observation.action].action)}.
            {" "}{observation.summary ? "Сводка запрошена." : "Сводка закрыта."}
            {" "}Пропущено функций: {observation.omitted.map((node) => labels[node]).join(", ") || "нет"}.
            {" "}Добавлено: {observation.added.map((node) => labels[node]).join(", ") || "нет"}.</p>}
          <Button variant="outline" disabled={!validation.diagnostics[forecast.rules.model]?.valid}
            onClick={() => inspect(validation.recording, validation.engine, validation.graph, forecast.rules.model, observation?.action)}>Разобрать проверку на полотне</Button>
        </div>}
      </>}
    </section>
  </main>;
}
