import { useEffect, useState } from "react";
import {
  createExperiment,
  formatEntry,
  formatValue,
  runScenario,
  sales,
  snapshotFromJournal,
} from "../experiment.ts";
import type { Operation, Snapshot } from "../experiment.ts";
import { Graph } from "./Graph.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Moon, RotateCcw, Sun } from "lucide-react";
import { ThemeTogglerButton, ThemeTogglerButtonIcon } from "@/components/animate-ui/buttons/theme-toggler";
import { Hint, TooltipProvider } from "@/components/ui/tooltip";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

function Journal({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: Snapshot;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const [filter, setFilter] = useState("all");
  const entries = snapshot.log
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        filter === "all" ||
        (filter === "computed"
          ? event.type === "computed"
          : ["read", "write", "result", "reset"].includes(event.type)),
    );
  const inspected =
    selected === null ? null : snapshotFromJournal(snapshot.log.slice(0, selected + 1));

  function exportJournal() {
    const text = snapshot.log.map(formatEntry).join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "reactivity-journal.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section id="journal" className="journal-section" aria-labelledby="journal-title">
      <div className="section-heading">
        <h2 id="journal-title">
          Журнал выполнения <span>{snapshot.log.length}</span>
        </h2>
        <label className="filter-label">
          Показать{" "}
          <NativeSelect
            aria-label="Фильтр журнала"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <NativeSelectOption value="all">Все события</NativeSelectOption>
            <NativeSelectOption value="operations">Операции и результаты</NativeSelectOption>
            <NativeSelectOption value="computed">Вызовы computed</NativeSelectOption>
          </NativeSelect>
        </label>
        <Hint text="Скачать полный журнал без фильтрации">
          <Button variant="outline" onClick={exportJournal}>Скачать TXT</Button>
        </Hint>
      </div>
      <div className="journal-layout">
        <div
          className="journal-scroll"
          tabIndex={0}
          aria-label="События журнала"
          data-testid="journal"
        >
          <ol className="journal-list">
            {entries.map(({ event, index }) => (
              <li key={index}>
                <button
                  className={`log-entry event-${event.type}`}
                  aria-pressed={selected === index}
                  onClick={() => onSelect(index)}
                >
                  <span className="event-index">{String(index + 1).padStart(2, "0")}</span>
                  <span>{formatEntry(event)}</span>
                </button>
              </li>
            ))}
          </ol>
          {entries.length === 0 && (
            <p className="empty-log">Вызовов пока нет. Прочитайте среднее.</p>
          )}
        </div>
        <aside className="journal-inspector" aria-label="Снимок события">
          <Hint text="К графу · ↑">
            <Button asChild variant="outline" size="icon-sm" className="scroll-to-graph">
              <a href="#graph" aria-label="К графу" aria-keyshortcuts="ArrowUp"><ArrowUp aria-hidden="true" /></a>
            </Button>
          </Hint>
          <h3>{selected === null ? "Как читать журнал" : `После события ${selected + 1}`}</h3>
          {inspected ? (
            <>
              <p>{formatEntry(snapshot.log[selected!])}</p>
              <dl>
                <dt>Порог</dt>
                <dd>{inspected.threshold}</dd>
                <dt>Чтения</dt>
                <dd>{inspected.readings.map(formatValue).join(", ") || "Ещё нет"}</dd>
              </dl>
              <p>
                Вызовы:{" "}
                {Object.entries(inspected.calls)
                  .map(([node, count]) => `${node}: ${count}`)
                  .join(" · ")}
              </p>
              <Button variant="link" className="h-auto px-0" onClick={() => onSelect(null)}>
                Закрыть снимок
              </Button>
            </>
          ) : (
            <p>
              Выберите событие, чтобы увидеть сохранённый снимок. Просмотр журнала не читает
              реактивный граф.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("reactivity-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // The theme still works for this session if storage is unavailable.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem("reactivity-theme", theme); } catch { /* Storage is optional. */ }
  }, [theme]);
  const [experiment, setExperiment] = useState(createExperiment);
  const [snapshot, setSnapshot] = useState(() => experiment.snapshot());
  const [draft, setDraft] = useState("20");
  const [session, setSession] = useState("Ручной опыт");
  const [generation, setGeneration] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);

  useEffect(() => {
    function handleScrollShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.target instanceof Element && event.target.closest(
        'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="switch"], .journal-scroll, .snapshot-panel, .operation-summary',
      )) return;

      const destination = event.key === "ArrowDown" ? "journal" : "graph";
      const section = document.getElementById(destination);
      if (!section) return;
      event.preventDefault();
      section.scrollIntoView();
    }

    window.addEventListener("keydown", handleScrollShortcut);
    return () => window.removeEventListener("keydown", handleScrollShortcut);
  }, []);

  function selectEvent(index: number | null) {
    setSelectedEvent(index);
    setSelectionVersion((version) => version + 1);
  }
  const validThreshold = draft.trim() !== "" && Number.isFinite(Number(draft));
  const stale =
    snapshot.evaluatedThreshold !== null && snapshot.evaluatedThreshold !== snapshot.threshold;

  function execute(operation: Operation) {
    selectEvent(null);
    setSnapshot(experiment.execute(operation));
    setSession("Ручной опыт");
  }
  function start(name?: "A" | "B") {
    selectEvent(null);
    const next = name ? runScenario(name) : createExperiment();
    setExperiment(next);
    setSnapshot(next.snapshot());
    setSession(name ? `Сценарий ${name}` : "Ручной опыт");
    setGeneration((value) => value + 1);
    setDraft("20");
  }

  return (
    <TooltipProvider>
    <main>
      <h1 className="sr-only">Лаборатория реактивности</h1>
      <div className="workspace">
        <section id="graph" className="graph-section" aria-label="Полотно эксперимента">
          <Graph
            snapshot={snapshot}
            selectedEvent={selectedEvent}
            selectionVersion={selectionVersion}
            theme={theme}
          />
          <Hint text="К журналу · ↓">
            <Button asChild variant="outline" size="icon-sm" className="scroll-to-journal">
              <a href="#journal" aria-label="К журналу" aria-keyshortcuts="ArrowDown"><ArrowDown aria-hidden="true" /></a>
            </Button>
          </Hint>
          <aside className="operations" aria-label="Управление экспериментом">
            <Hint text="В выборку входят продажи, которые больше или равны порогу">
              <div className="sales-compact" tabIndex={0} aria-label={`Продажи: ${sales.join(", ")}`}>
                <span>Продажи</span> {sales.join(" · ")}
              </div>
            </Hint>
            <form
              className="write-controls"
              onSubmit={(event) => {
                event.preventDefault();
                if (validThreshold) execute({ type: "write", value: Number(draft) });
              }}
            >
              <label className="sr-only" htmlFor="threshold">Новый порог</label>
              <Input
                id="threshold"
                className="w-[120px]! flex-none"
                type="number"
                step="any"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Hint text="Записать новый порог">
                <span tabIndex={validThreshold ? -1 : 0}>
                  <Button size="sm" variant="outline" disabled={!validThreshold} type="submit">Записать</Button>
                </span>
              </Hint>
            </form>
            <Hint text="Прочитать среднее">
              <Button size="sm" onClick={() => execute({ type: "read" })} aria-label="Прочитать среднее">Прочитать</Button>
            </Hint>
            <div className="scenario-controls" aria-label="Готовые сценарии">
              <span>Сценарии</span>
              <Hint text="Сценарий A: чтение после каждой записи">
                <Button size="sm" variant="outline" onClick={() => start("A")} aria-label="Запустить сценарий A">A</Button>
              </Hint>
              <Hint text="Сценарий B: две записи, затем чтение">
                <Button size="sm" variant="outline" onClick={() => start("B")} aria-label="Запустить сценарий B">B</Button>
              </Hint>
            </div>
            <Hint text="Начать с чистого графа">
              <Button size="icon-sm" variant="ghost" onClick={() => start()} aria-label="Начать с чистого графа">
                <RotateCcw aria-hidden="true" />
              </Button>
            </Hint>
            <Hint text={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
              <ThemeTogglerButton
                theme={theme}
                resolvedTheme={theme}
                setTheme={(next) => { if (next !== "system") setTheme(next); }}
                modes={["light", "dark"]}
                variant="ghost"
                size="sm"
                aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              >
                <ThemeTogglerButtonIcon light={<Sun />} dark={<Moon />} />
              </ThemeTogglerButton>
            </Hint>
          </aside>
          <aside className="snapshot-panel" aria-label="Результаты прогона">
            <div className="snapshot-heading"><strong>{session}</strong><span>Порог {snapshot.threshold}</span></div>
            <div className={`snapshot-status ${stale ? "stale" : ""}`} role="status">
              {snapshot.evaluatedThreshold === null
                ? "В прогоне ещё нет чтений. Все счётчики равны нулю."
                : stale
                  ? `Текущий порог — ${snapshot.threshold}. Последнее чтение при пороге ${snapshot.evaluatedThreshold}.`
                  : `Последнее чтение при пороге ${snapshot.evaluatedThreshold}.`}
            </div>
            <div className="readings">
              <span>Результаты чтений</span>
              <output aria-label="Результаты чтений" data-testid="readings">
                {snapshot.readings.length
                  ? snapshot.readings.map(formatValue).join(" → ")
                  : "Ещё нет"}
              </output>
            </div>
            <table className="counter-table" aria-label="Счётчики вызовов computed">
              <caption>Вычисления</caption>
              <thead>
                <tr>
                  {["filtered", "sum", "count", "average"].map((node) => (
                    <th scope="col" key={node}>{node}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {Object.entries(snapshot.calls).map(([node, count]) => (
                    <td key={node} data-testid={`total-${node}`}>{count}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </aside>
        </section>
        <Journal
          key={generation}
          snapshot={snapshot}
          selected={selectedEvent}
          onSelect={selectEvent}
        />
      </div>
    </main>
    </TooltipProvider>
  );
}
