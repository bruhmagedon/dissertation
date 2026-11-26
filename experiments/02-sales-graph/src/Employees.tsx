import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { Select, SelectItem } from "@/components/ui/select";
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
  const initial = useRef(opening.first);
  const [guidedExample, setGuidedExample] = useState(false);
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
    initial.current = next.first;
    setGuidedExample(false);
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
    onInspect({ recording: source, engine: "preact", graph: runner.current.graph, policy: "baseline", primary: frames, initial: initial.current, action: index, back: "employees" });
  }

  return <main className="lab-page">
    <header className="lab-page-head">
      <div><h1>Сотрудники</h1><p>Синтетические данные · {recording.data.kind === "demo" ? "Разбор по шагам" : recording.data.size.toLocaleString("ru-RU") + " записей · seed " + recording.data.seed}</p></div>
      <Button variant="outline" onClick={() => apply({ type: "summary", open: !view.summary })} aria-expanded={view.summary}>
        {view.summary ? "Закрыть сводку" : "Открыть сводку"}
      </Button>
    </header>
    <section className="lab-card guided-example">
      <h2>Готовый пример с Борисом</h2>
      <p>Стенд откроет сводку и переведёт Бориса из продаж в поддержку. Сравните, останется ли он в таблице и как поменяется число сотрудников в отделах.</p>
      <div className="lab-controls">
        <Button disabled={status === "recording"} onClick={() => { load(borisRecording(false), "finished"); setGuidedExample(true); }}>Пример «Все отделы»</Button>
        <Button variant="outline" disabled={status === "recording"} onClick={() => { load(borisRecording(true), "finished"); setGuidedExample(true); }}>Контроль «Продажи»</Button>
      </div>
      {guidedExample && <div className="guided-example-next">
        <p>Пример выполнен. Таблица и сводка ниже показывают итог перевода. Выберите действие, чтобы увидеть, как экран получил результат.</p>
        <div className="lab-controls">
          <Button variant="outline" onClick={() => inspect(1)}>Разобрать открытие сводки</Button>
          <Button variant="outline" onClick={() => inspect(2)}>Разобрать перевод Бориса</Button>
        </div>
      </div>}
    </section>
    <div className="employee-workspace">
      <section className="lab-card employee-table" aria-label="Таблица сотрудников">
        <form className="lab-controls table-filters" onSubmit={(event) => { event.preventDefault(); apply({ type: "search", query: search }); }}>
          <label>Поиск по имени<Input value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} /></label>
          <Button type="submit">Найти</Button>
          <label>Отдел<Select aria-label="Отдел" value={view.department || "all"} onValueChange={(value) => apply({ type: "filter", department: value === "all" ? "" : value as Department })}>
            <SelectItem value="all">Все отделы</SelectItem>{departments.map((department) => <SelectItem key={department} value={String(department)}>{department}</SelectItem>)}
          </Select></label>
          <label>Сортировка<Select aria-label="Сортировка" value={view.sort} onValueChange={(value) => apply({ type: "sort", sort: value as Sort })}>
            <SelectItem value="name">Имя А–Я</SelectItem><SelectItem value="name-desc">Имя Я–А</SelectItem><SelectItem value="id">ID</SelectItem>
          </Select></label>
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
    <section className="lab-card lab-recording">
      <div className="lab-section-head">
        <h2>Запись действий</h2>
        <span role="status">{status === "recording" ? "Идёт запись" : status === "finished" ? recording.name + " · завершена" : "Ожидает запуска"} · {frames.length} действий</span>
      </div>
      <div className="lab-controls">
        <label>Профиль<Select aria-label="Профиль" value={profile} disabled={status === "recording"} onValueChange={(value) => setProfile(value as typeof profile)}>
          <SelectItem value="demo">Разбор по шагам</SelectItem>{Object.entries(profileLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
        </Select></label>
        {profile !== "demo" && <>
          <label>Сотрудников<Select aria-label="Сотрудников" disabled={status === "recording"} value={String(size)} onValueChange={(value) => setSize(Number(value) as Size)}>{sizes.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</Select></label>
          <label>Seed<Input className="w-24" type="number" min="0" step="1" disabled={status === "recording"} value={seed} onChange={(event) => setSeed(event.target.value)} /></label>
        </>}
        {status === "recording" ?
          <Button disabled={!frames.length} onClick={save}>Завершить и сохранить</Button> :
          <>
            <Button onClick={() => act(() => load(scenario(), "recording"))}>Начать запись</Button>
            <Button variant="outline" onClick={() => act(() => load(scenario(), "finished"))}>Воспроизвести пресет</Button>
            {saved && <Button variant="outline" onClick={() => load(saved, "finished")}>Открыть сохранённую</Button>}
          </>}
        {status !== "recording" && <FileInput aria-label="Импорт записи" accept=".json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }}>Импорт записи</FileInput>}
      </div>
      {status === "finished" && <div className="lab-controls">
        <Button variant="outline" onClick={() => load(recording, "finished")}>Повторить с начала</Button>
        <Button variant="outline" onClick={() => downloadJson("employee-recording.json", recording)}>Скачать запись JSON</Button>
        <Button disabled={!recording.steps.length} onClick={() => onResearch(recording)}>В исследование</Button>
      </div>}
      {error && <p role="alert" className="lab-error">{error}</p>}
      {frames.length ? <ol className="employee-journal">{frames.map((frame, index) => <li key={index}>
        <Button variant="ghost" aria-label={`Открыть действие ${index + 1} на полотне · ${describeAction(frame.step.action)}`}
          onClick={() => inspect(index)}>{index + 1}. {describeAction(frame.step.action)}</Button>
        {recording.data.kind === "demo" && frame.step.action.type === "department" &&
          frame.step.action.id === 9 && frame.step.action.department === "Поддержка" &&
          <Button size="sm" variant="outline" onClick={() => act(() => onInspect(inspectArchitectures(
            { ...recording, steps: frames.map(({ step }) => step) }, "preact", ["A0", "A1", "B0"], "employees", index,
          )))}>Сравнить A0, A1 и B0</Button>}
        <span>ID [{frame.result.rows.map(({ id }) => id).join(", ")}]
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
            <label>Новый отдел<Select aria-label="Новый отдел" value={editor.department} onValueChange={(value) => setEditor({ ...editor, department: value as Department })}>
              {departments.map((department) => <SelectItem key={department} value={String(department)}>{department}</SelectItem>)}
            </Select></label>
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
