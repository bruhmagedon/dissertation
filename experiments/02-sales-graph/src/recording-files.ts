import { parseRecording } from "../employees/import.ts";
import type { Recording } from "../employees/recording.ts";

export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function savedRecording(): Recording | undefined {
  try {
    const saved = localStorage.getItem("employee-recording-v1");
    return saved ? parseRecording(JSON.parse(saved)) : undefined;
  } catch {
    return undefined;
  }
}

export function persistRecording(recording: Recording) {
  localStorage.setItem("employee-recording-v1", JSON.stringify(recording));
}
