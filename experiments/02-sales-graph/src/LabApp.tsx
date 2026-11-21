import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SalesLab } from "./App.tsx";
import { EmployeeGraph } from "./EmployeeGraph.tsx";
import { Employees } from "./Employees.tsx";
import type { initialEmployeeScreen } from "./Employees.tsx";
import { Research } from "./Research.tsx";
import type { Inspection } from "./employee-inspection.ts";
import type { Recording } from "../employees/recording.ts";

function route() {
  const hash = window.location.hash;
  if (hash === "#/employees") return { page: "employees" } as const;
  if (hash === "#/research") return { page: "research" } as const;
  const operation = /^#\/laboratory\/employees\/([\w-]+)\/(\d+)$/.exec(hash);
  if (operation) return { page: "employeeGraph", key: operation[1], index: Number(operation[2]) - 1 } as const;
  return { page: "sales" } as const;
}

function themeFromStorage(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("reactivity-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Хранилище необязательно. */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function restoredInspection(key: string): Inspection | undefined {
  try {
    const raw = sessionStorage.getItem("employee-inspection/" + key);
    if (raw) return JSON.parse(raw) as Inspection;
  } catch { /* Хранилище необязательно. */ }
}

export function LabApp({ employeeScreen }: { employeeScreen: ReturnType<typeof initialEmployeeScreen> }) {
  const [location, setLocation] = useState(route);
  const [theme, setTheme] = useState(themeFromStorage);
  const [inspection, setInspection] = useState(() =>
    location.page === "employeeGraph" ? restoredInspection(location.key) : undefined);
  const inspections = useRef(new Map<string, Inspection>());
  const [recording, setRecording] = useState<Recording>();

  useEffect(() => {
    function navigate() {
      const next = route();
      setLocation(next);
      if (next.page === "employeeGraph") setInspection(inspections.current.get(next.key) ?? restoredInspection(next.key));
      if (window.location.hash.startsWith("#/")) window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem("reactivity-theme", theme); } catch { /* Хранилище необязательно. */ }
  }, [theme]);

  function openInspection(item: Inspection) {
    const key = crypto.randomUUID?.() ?? Date.now().toString(36);
    inspections.current.set(key, item);
    try {
      const entry = JSON.stringify(item, (key, value: unknown) => key === "orderedIds" ? undefined : value);
      sessionStorage.setItem("employee-inspection/" + key, entry);
    } catch { /* Снимок доступен в памяти открытой страницы. */ }
    window.location.hash = "/laboratory/employees/" + key + "/" + (item.action + 1);
  }
  const page = location.page;
  const laboratory = page === "sales" || page === "employeeGraph";
  const index = location.page === "employeeGraph" && inspection?.primary[location.index] ? location.index : inspection?.action ?? 0;

  return <TooltipProvider>
    <header className="lab-navigation">
      <a className="lab-brand" href="#/laboratory">Лаборатория реактивности</a>
      <nav aria-label="Разделы стенда">
        <a aria-current={laboratory ? "page" : undefined} href="#/laboratory">Лаборатория</a>
        <a aria-current={page === "employees" ? "page" : undefined} href="#/employees">Сотрудники</a>
        <a aria-current={page === "research" ? "page" : undefined} href="#/research">Исследование</a>
      </nav>
      {page !== "sales" && <Button variant="ghost" size="icon-sm" aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>}
    </header>
    <div hidden={page !== "sales"}><SalesLab theme={theme} setTheme={setTheme} /></div>
    <div hidden={page !== "employees"}><Employees opening={employeeScreen} onInspect={openInspection}
      onResearch={(source) => { setRecording(source); window.location.hash = "/research"; }} /></div>
    <div hidden={page !== "research"}><Research incoming={recording} onInspect={openInspection} /></div>
    {location.page === "employeeGraph" && (inspection ? <EmployeeGraph key={location.key} inspection={inspection} index={index} theme={theme}
      onAction={(next) => { window.location.hash = "/laboratory/employees/" + location.key + "/" + (next + 1); }}
      onBack={() => { window.location.hash = "/" + inspection.back; }} /> :
      <main className="lab-page"><h1>Полотно сотрудников</h1><p>Откройте записанное действие из таблицы сотрудников или результатов исследования.</p>
        <Button asChild><a href="#/employees">К сотрудникам</a></Button></main>)}
  </TooltipProvider>;
}
