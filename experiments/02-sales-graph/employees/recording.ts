export const departments = ["Продажи", "Поддержка", "Разработка", "Операции"] as const;
export type Department = typeof departments[number];
export const sorts = ["name", "name-desc", "id"] as const;
export type Sort = typeof sorts[number];
export const outputs = ["rows", "pagination", "summary"] as const;
export type Output = typeof outputs[number];
export const sizes = [100, 1_000, 10_000] as const;
export type Size = typeof sizes[number];
export const profileLabels = {
  editing: "Редактирование карточек",
  departments: "Анализ отделов",
  mixed: "Поиск и страницы",
};
export type Profile = keyof typeof profileLabels;

export interface Employee {
  id: number;
  name: string;
  department: Department;
  role: string;
  phone: string;
}

export interface View {
  query: string;
  department: Department | "";
  sort: Sort;
  page: number;
  pageSize: number;
  summary: boolean;
}

export type Data = { kind: "demo" } | { kind: "generated"; size: Size; seed: number };
export type Action =
  | { type: "read" }
  | { type: "search"; query: string }
  | { type: "filter"; department: Department | "" }
  | { type: "sort"; sort: Sort }
  | { type: "page"; page: number }
  | { type: "summary"; open: boolean }
  | { type: "phone"; id: number; phone: string }
  | { type: "department"; id: number; department: Department };

export interface Step { action: Action; outputs: Output[] }
export interface Recording {
  schema: 1;
  name: string;
  profile: Profile | "demo" | "custom";
  data: Data;
  initial: View;
  steps: Step[];
}

export const defaultView: View = {
  query: "", department: "", sort: "name", page: 0, pageSize: 20, summary: false,
};

export function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function generateEmployees(data: Data): Employee[] {
  if (data.kind === "demo") return [
    { id: 7, name: "Анна", department: "Продажи", role: "Менеджер", phone: "+7 900 000-00-07" },
    { id: 9, name: "Борис", department: "Продажи", role: "Консультант", phone: "+7 900 000-00-09" },
    { id: 15, name: "Вера", department: "Поддержка", role: "Специалист", phone: "+7 900 000-00-15" },
  ];
  const next = random(data.seed);
  const names = ["Анна", "Борис", "Вера", "Денис", "Елена", "Иван", "Мария", "Олег"];
  const families = ["Александров", "Волков", "Ким", "Лебедев", "Морозов", "Орлов"];
  const roles = ["Менеджер", "Консультант", "Специалист", "Аналитик"];
  return Array.from({ length: data.size }, (_, index) => ({
    id: index + 1,
    name: names[Math.floor(next() * names.length)] + " " + families[Math.floor(next() * families.length)],
    department: departments[Math.floor(next() * departments.length)],
    role: roles[Math.floor(next() * roles.length)],
    phone: "+7 900 " + String(index + 1).padStart(7, "0").replace(/(...)(..)(..)$/, "$1-$2-$3"),
  }));
}

export function makeStep(action: Action, summary: boolean): Step {
  const open = action.type === "summary" ? action.open : summary;
  return { action, outputs: open ? ["rows", "pagination", "summary"] : ["rows", "pagination"] };
}

export function demoRecording(): Recording {
  const actions: Action[] = [
    { type: "summary", open: true },
    { type: "phone", id: 7, phone: "+7 900 111-11-11" },
    { type: "department", id: 9, department: "Поддержка" },
    { type: "filter", department: "Поддержка" },
  ];
  return {
    schema: 1, name: "Разбор по шагам", profile: "demo", data: { kind: "demo" },
    initial: { ...defaultView, pageSize: 2 },
    steps: actions.map((action) => makeStep(action, true)),
  };
}

export function preset(profile: Profile, size: Size, seed: number, session = 0): Recording {
  const data = { kind: "generated", size, seed } as const;
  const people = generateEmployees(data);
  const next = random((seed ^ Math.imul(session + 1, 0x9e3779b1)) >>> 0);
  const initial = { ...defaultView, summary: profile === "departments" };
  let summary = initial.summary;
  const steps: Step[] = [];
  function add(action: Action) {
    steps.push(makeStep(action, summary));
    if (action.type === "summary") summary = action.open;
  }
  const collator = new Intl.Collator("ru");
  const byName = [...people].sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
  const descending = [...people].sort((a, b) => collator.compare(b.name, a.name) || a.id - b.id);
  const choose = (visible: Employee[]) => visible[Math.floor(next() * visible.length)];
  const getPage = (list: Employee[], page: number) =>
    list.slice(page * initial.pageSize, (page + 1) * initial.pageSize);
  function changeDepartment(person: Employee, index: number) {
    const department = departments[(departments.indexOf(person.department) + 1 + index % 3) % departments.length];
    add({ type: "department", id: person.id, department });
    person.department = department;
  }
  function changePhone(person: Employee, index: number) {
    add({ type: "phone", id: person.id, phone: "+7 901 " + String(session * 100 + index + 1).padStart(7, "0") });
  }
  let page = 0;
  for (let i = 0; i < 8; i++) {
    if (profile === "editing") {
      const person = choose(getPage(byName, page));
      changePhone(person, i);
      changeDepartment(person, i);
      page = i % Math.ceil(size / initial.pageSize);
      add({ type: "page", page });
    } else if (profile === "departments") {
      const filter = i % 2 ? choose(people).department : "";
      add({ type: "filter", department: filter });
      const ordered = i > 0 && i % 2 === 0 ? descending : byName;
      const matching = filter ? ordered.filter((person) => person.department === filter) : ordered;
      changeDepartment(choose(getPage(matching, 0)), i);
      add({ type: "sort", sort: i % 2 ? "name-desc" : "name" });
    } else {
      const query = i % 2 ? choose(people).name.split(" ")[0] : "";
      const matching = query ? byName.filter((person) => person.name.startsWith(query + " ")) : byName;
      page = Math.min(i % 3, Math.ceil(matching.length / initial.pageSize) - 1);
      add({ type: "search", query });
      add({ type: "page", page });
      add({ type: "summary", open: i % 3 === 0 });
      changePhone(choose(getPage(matching, page)), i);
    }
  }
  return { schema: 1, name: profileLabels[profile] + " · запись " + (session + 1), profile, data, initial, steps };
}

export function describeAction(action: Action): string {
  switch (action.type) {
    case "read": return "Прочитать открытые выходы";
    case "search": return action.query ? "Найти «" + action.query + "»" : "Очистить поиск";
    case "filter": return "Отдел — " + (action.department || "все");
    case "sort": return "Сортировка — " + ({ name: "имя А–Я", "name-desc": "имя Я–А", id: "ID" }[action.sort]);
    case "page": return "Открыть страницу " + (action.page + 1);
    case "summary": return action.open ? "Открыть сводку" : "Закрыть сводку";
    case "phone": return "Изменить телефон #" + action.id + " на " + action.phone;
    case "department": return "Перевести #" + action.id + " в отдел «" + action.department + "»";
  }
}
