import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
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
    <section className="journal-section" aria-labelledby="journal-title">
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
        <Button
          variant="outline"
          onClick={exportJournal}
          title="Скачать полный журнал без фильтрации"
        >
          Скачать TXT
        </Button>
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
  const [experiment, setExperiment] = useState(createExperiment);
  const [snapshot, setSnapshot] = useState(() => experiment.snapshot());
  const [draft, setDraft] = useState("20");
  const [session, setSession] = useState("Ручной опыт");
  const [generation, setGeneration] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
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
    <main>
      <header className="page-header">
        <div>
          <h1>Лаборатория реактивности</h1>
          <p>Когда запись превращается в вычисление?</p>
        </div>
        <span className="library-label">
          @preact/signals-core <strong>1.14.5</strong>
        </span>
      </header>
      <div className="workspace">
        <aside className="operations" aria-label="Управление экспериментом">
          <h2>Продажи</h2>
          <div className="sales">
            {sales.map((value) => (
              <Badge key={value} variant="secondary">
                {value}
              </Badge>
            ))}
          </div>
          <p className="muted">В выборку входят продажи ≥ порога.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (validThreshold) execute({ type: "write", value: Number(draft) });
            }}
          >
            <label htmlFor="threshold">Новый порог</label>
            <div className="write-controls">
              <Input
                id="threshold"
                type="number"
                step="any"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button variant="outline" disabled={!validThreshold} type="submit">
                Записать
              </Button>
            </div>
          </form>
          <Button className="read-button" onClick={() => execute({ type: "read" })}>
            Прочитать среднее
          </Button>
          <p className="operation-hint">Запись меняет вход. Только чтение запрашивает результат.</p>
          <div className="scenario-controls">
            <h2>Готовые сценарии</h2>
            <Button
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-3 text-left"
              onClick={() => start("A")}
            >
              <strong>Запустить A</strong>
              <span>Чтение после каждой записи</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-3 text-left"
              onClick={() => start("B")}
            >
              <strong>Запустить B</strong>
              <span>Две записи, затем чтение</span>
            </Button>
            <p className="muted">
              Каждый запуск создаёт новый граф и сначала читает среднее при пороге 10.
            </p>
          </div>
          <Button variant="link" className="h-auto px-0" onClick={() => start()}>
            Начать с чистого графа
          </Button>
        </aside>
        <section className="graph-section" aria-labelledby="graph-title">
          <div className="section-heading">
            <h2 id="graph-title">{session}</h2>
            <span className="graph-note">Выберите операцию в журнале · холст можно двигать</span>
          </div>
          <Graph
            snapshot={snapshot}
            selectedEvent={selectedEvent}
            selectionVersion={selectionVersion}
          />
          <div className={`snapshot-status ${stale ? "stale" : ""}`} role="status">
            {snapshot.evaluatedThreshold === null
              ? "В прогоне ещё нет чтений. Все счётчики равны нулю."
              : stale
                ? `Текущий порог прогона — ${snapshot.threshold}. Последнее чтение было при пороге ${snapshot.evaluatedThreshold}.`
                : `Последнее чтение в прогоне при пороге ${snapshot.evaluatedThreshold}.`}
          </div>
          <div className="readings">
            <span>Результаты чтений</span>
            <output aria-label="Результаты чтений" data-testid="readings">
              {snapshot.readings.length
                ? snapshot.readings.map(formatValue).join(" → ")
                : "Ещё нет — прочитайте среднее"}
            </output>
          </div>
          <table className="counter-table" aria-label="Счётчики вызовов computed">
            <caption>Фактические вызовы computed</caption>
            <thead>
              <tr>
                <th scope="col">Узел</th>
                {["filtered", "sum", "count", "average"].map((node) => (
                  <th scope="col" key={node}>
                    {node}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Вызовы</th>
                {Object.entries(snapshot.calls).map(([node, count]) => (
                  <td key={node} data-testid={`total-${node}`}>
                    {count}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
        <Journal
          key={generation}
          snapshot={snapshot}
          selected={selectedEvent}
          onSelect={selectEvent}
        />
      </div>
      <footer>
        Общая выборка для суммы и количества. Интерфейс показывает снимки журнала и не подписывается
        на signals.
      </footer>
    </main>
  );
}
