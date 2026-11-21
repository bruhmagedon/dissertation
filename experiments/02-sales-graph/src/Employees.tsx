import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { borisRecording } from "../employees/conditions.ts";
import { createEmployeeRun } from "../employees/engine.ts";
import type { Frame } from "../employees/engine.ts";
import { parseRecording } from "../employees/import.ts";
import { demoRecording, departments, describeAction, makeStep, preset, profileLabels, sizes } from "../employees/recording.ts";
import type { Action, Department, Profile, Recording, Size, Sort } from "../employees/recording.ts";
import { inspectArchitectures } from "./employee-inspection.ts";
import type { Inspection } from "./employee-inspection.ts";
import { downloadJson, persistRecording, savedRecording } from "./recording-files.ts";

function playback(recording: Recording, replay: boolean) {
  const runner = createEmployeeRun(recording, "preact", "baseline");
  const first = runner.capture(runner.initialStep);
  const frames = replay ? recording.steps.map((step) => runner.capture(step)) : [];
  return { runner, first, frames };
}

export function Employees({ opening, onInspect, onResearch }: {
  opening: ReturnType<typeof playback>;
  onInspect: (inspection: Inspection) => void;
  onResearch: (recording: Recording) => void;
}) {
  const runner = useRef(opening.runner);
  const [recording, setRecording] = useState(demoRecording);
  const [saved, setSaved] = useState(savedRecording);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [current, setCurrent] = useState(opening.first);
  const [status, setStatus] = useState<"ready" | "recording" | "finished">("ready");
  const [profile, setProfile] = useState<Profile | "demo">("demo");
  const [size, setSize] = useState<Size>(100);
  const [seed, setSeed] = useState("42");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ id: number; name: string; phone: string; department: Department } | null>(null);
  const [error, setError] = useState("");
  const view = runner.current.view();
  const { rows, pagination, summary } = current.result;

  function scenario() {
    if (profile === "demo") return demoRecording();
    const number = Number(seed);
    if (!seed.trim() || !Number.isInteger(number) || number < 0 || number > 0xffffffff) {
      throw new Error("Seed должен быть целым числом от 0 до 4294967295.");
    }
    return preset(profile, size, number);
  }
  function load(source: Recording, nextStatus: typeof status) {
    const replay = nextStatus === "finished";
    const next = playback(source, replay);
    runner.current = next.runner;
    setRecording(replay ? source : { ...source, name: "Моя запись", profile: "custom", steps: [] });
    setFrames(next.frames);
    setCurrent(next.frames.at(-1) ?? next.first);
    setSearch(next.runner.view().query);
    setEditor(null);
    setStatus(nextStatus);
    setError("");
  }
  function apply(action: Action) {
    if (status === "recording" && frames.length >= 500) {
      setError("Запись достигла 500 действий. Завершите её.");
      return;
    }
    const frame = runner.current.capture(makeStep(action, runner.current.view().summary));
    setCurrent(frame);
    if (status === "recording") setFrames((log) => [...log, frame]);
  }
  function save() {
    const next = { ...recording, steps: frames.map((frame) => frame.step) };
    setRecording(next);
    setStatus("finished");
    try { persistRecording(next); setSaved(next); setError(""); }
    catch { setError("Локальное хранилище недоступно. Запись можно скачать."); }
  }
  function act(fn: () => void) {
    try { fn(); } catch (issue) { setError((issue as Error).message); }
  }
  async function importFile(file: File) {
    try {
      const next = parseRecording(JSON.parse(await file.text()));
      load(next, "finished");
    } catch (issue) { setError("Импорт записи: " + (issue as Error).message); }
  }
  function inspect(index: number) {
    const source = { ...recording, steps: frames.map((frame) => frame.step) };
    onInspect({ recording: source, engine: "preact", graph: runner.current.graph, policy: "baseline", primary: frames, action: index, back: "employees" });
  }

  return <main className="lab-page">
    <header className="lab-page-head">
      <div><h1>Сотрудники</h1><p>Синтетические данные · {recording.data.kind === "demo" ? "Разбор по шагам" : recording.data.size.toLocaleString("ru-RU") + " записей · seed " + recording.data.seed}</p></div>
      <Button variant="outline" onClick={() => apply({ type: "summary", open: !view.summary })} aria-expanded={view.summary}>
        {view.summary ? "Закрыть сводку" : "Открыть сводку"}
      </Button>
    </header>
    <div className="employee-workspace">
      <section className="lab-card employee-table" aria-label="Таблица сотрудников">
        <form className="lab-controls table-filters" onSubmit={(event) => { event.preventDefault(); apply({ type: "search", query: search }); }}>
          <label>Поиск по имени<Input value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} /></label>
          <Button type="submit">Найти</Button>
          <label>Отдел<NativeSelect aria-label="Отдел" value={view.department} onChange={(event) => apply({ type: "filter", department: event.target.value as Department | "" })}>
            <option value="">Все отделы</option>{departments.map((department) => <option key={department}>{department}</option>)}
          </NativeSelect></label>
          <label>Сортировка<NativeSelect aria-label="Сортировка" value={view.sort} onChange={(event) => apply({ type: "sort", sort: event.target.value as Sort })}>
            <option value="name">Имя А–Я</option><option value="name-desc">Имя Я–А</option><option value="id">ID</option>
          </NativeSelect></label>
        </form>
        <div className="lab-table-scroll">
          <table className="lab-table">
            <thead><tr><th>ID</th><th>Имя</th><th>Отдел</th><th>Должность</th><th>Телефон</th><th scope="col" aria-label="Редактирование" /></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}>
              <td>{row.id}</td><th scope="row">{row.name}</th><td>{row.department}</td><td>{row.role}</td><td>{row.phone}</td>
              <td><Button size="sm" variant="ghost" aria-label={"Редактировать " + row.name + " #" + row.id} onClick={() => setEditor(row)}>Изменить</Button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!rows.length && <p className="lab-empty">Сотрудники не найдены.</p>}
        <footer className="lab-controls table-footer">
          <span>{pagination.total} сотрудников · {pagination.pages ? "страница " + (pagination.page + 1) + " из " + pagination.pages : "нет страниц"}</span>
          <Button size="sm" variant="outline" disabled={pagination.page === 0} onClick={() => apply({ type: "page", page: pagination.page - 1 })}>Назад</Button>
          <Button size="sm" variant="outline" disabled={pagination.page + 1 >= pagination.pages} onClick={() => apply({ type: "page", page: pagination.page + 1 })}>Вперёд</Button>
        </footer>
      </section>
      {summary && <section className="lab-card lab-summary" aria-labelledby="department-summary">
        <h2 id="department-summary">Сводка по отделам</h2>
        {summary.length ? <dl>{summary.map(([department, count]) => <div key={department}><dt>{department}</dt><dd>{count}</dd></div>)}</dl> : <p>По текущему отбору нет сотрудников.</p>}
      </section>}
    </div>
    <section className="lab-card">
      <h2>Перевод Бориса</h2>
      <p>В обоих примерах сводка открыта. Последнее действие переводит Бориса из «Продаж» в «Поддержку».</p>
      <div className="lab-controls">
        <Button variant="outline" disabled={status === "recording"} onClick={() => load(borisRecording(false), "finished")}>Пример «Все отделы»</Button>
        <Button variant="outline" disabled={status === "recording"} onClick={() => load(borisRecording(true), "finished")}>Контроль «Продажи»</Button>
      </div>
    </section>
    <section className="lab-card lab-recording">
      <div className="lab-section-head">
        <h2>Запись действий</h2>
        <span role="status">{status === "recording" ? "Идёт запись" : status === "finished" ? recording.name + " · завершена" : "Ожидает запуска"} · {frames.length} действий</span>
      </div>
      <div className="lab-controls">
        <label>Профиль<NativeSelect aria-label="Профиль" value={profile} disabled={status === "recording"} onChange={(event) => setProfile(event.target.value as typeof profile)}>
          <option value="demo">Разбор по шагам</option>{Object.entries(profileLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </NativeSelect></label>
        {profile !== "demo" && <>
          <label>Сотрудников<NativeSelect aria-label="Сотрудников" disabled={status === "recording"} value={size} onChange={(event) => setSize(Number(event.target.value) as Size)}>{sizes.map((item) => <option key={item}>{item}</option>)}</NativeSelect></label>
          <label>Seed<Input className="lab-number" type="number" min="0" step="1" disabled={status === "recording"} value={seed} onChange={(event) => setSeed(event.target.value)} /></label>
        </>}
        {status === "recording" ?
          <Button disabled={!frames.length} onClick={save}>Завершить и сохранить</Button> :
          <>
            <Button onClick={() => act(() => load(scenario(), "recording"))}>Начать запись</Button>
            <Button variant="outline" onClick={() => act(() => load(scenario(), "finished"))}>Воспроизвести пресет</Button>
            {saved && <Button variant="outline" onClick={() => load(saved, "finished")}>Открыть сохранённую</Button>}
          </>}
        {status !== "recording" && <label className="lab-upload">Импорт записи<input aria-label="Импорт записи" type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }} /></label>}
      </div>
      {status === "finished" && <div className="lab-controls">
        <Button variant="outline" onClick={() => load(recording, "finished")}>Повторить с начала</Button>
        <Button variant="outline" onClick={() => downloadJson("employee-recording.json", recording)}>Скачать запись JSON</Button>
        <Button disabled={!recording.steps.length} onClick={() => onResearch(recording)}>В исследование</Button>
      </div>}
      {error && <p role="alert" className="lab-error">{error}</p>}
      {frames.length ? <ol className="employee-journal">{frames.map((frame, index) => <li key={index}>
        <Button variant="ghost" onClick={() => inspect(index)}>Открыть действие {index + 1} на полотне</Button>
        {recording.data.kind === "demo" && frame.step.action.type === "department" &&
          frame.step.action.id === 9 && frame.step.action.department === "Поддержка" &&
          <Button size="sm" variant="outline" onClick={() => act(() => onInspect(inspectArchitectures(
            { ...recording, steps: frames.map(({ step }) => step) }, "preact", ["A0", "A1", "B0"], "employees", index,
          )))}>Сравнить A0, A1 и B0</Button>}
        <span>{describeAction(frame.step.action)} · ID [{frame.result.rows.map(({ id }) => id).join(", ")}]
          {frame.result.summary && " · " + frame.result.summary.map(([department, count]) => department + " " + count).join(", ")}</span>
      </li>)}</ol> : <p className="lab-empty">В журнале ещё нет действий. Поиск записывается после подтверждения.</p>}
    </section>
    <Drawer open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
      <DrawerContent className="employee-editor">
        <DrawerHeader><DrawerTitle>{editor?.name} · #{editor?.id}</DrawerTitle>
          <DrawerDescription>Телефон и отдел сохраняются отдельными действиями.</DrawerDescription></DrawerHeader>
        {editor && <div className="employee-edit-fields">
          <form className="lab-controls" onSubmit={(event) => {
            event.preventDefault();
            if (editor.phone.trim()) { apply({ type: "phone", id: editor.id, phone: editor.phone.trim() }); setEditor(null); }
          }}>
            <label>Телефон<Input type="tel" required maxLength={40} value={editor.phone} onChange={(event) => setEditor({ ...editor, phone: event.target.value })} /></label>
            <Button type="submit">Сохранить телефон</Button>
          </form>
          <form className="lab-controls" onSubmit={(event) => {
            event.preventDefault();
            apply({ type: "department", id: editor.id, department: editor.department });
            setEditor(null);
          }}>
            <label>Новый отдел<NativeSelect aria-label="Новый отдел" value={editor.department} onChange={(event) => setEditor({ ...editor, department: event.target.value as Department })}>
              {departments.map((department) => <option key={department}>{department}</option>)}
            </NativeSelect></label>
            <Button type="submit">Сохранить отдел</Button>
          </form>
          <Button variant="outline" onClick={() => setEditor(null)}>Закрыть</Button>
        </div>}
      </DrawerContent>
    </Drawer>
  </main>;
}

export function initialEmployeeScreen() {
  return playback(demoRecording(), false);
}
