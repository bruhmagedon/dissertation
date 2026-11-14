import { FlaskConical, X } from "lucide-react";
import { selectionModes } from "../experiment.ts";
import type { SelectionMode } from "../experiment.ts";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";

export function Hypotheses({ mode, onChange }: { mode: SelectionMode; onChange: (mode: SelectionMode) => void }) {
  return (
    <Drawer direction="right">
      <DrawerTrigger asChild>
        <Button size="sm" variant="outline"><FlaskConical aria-hidden="true" />Гипотезы</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle>Гипотезы</DrawerTitle>
            <DrawerClose asChild><Button size="icon-sm" variant="ghost" aria-label="Закрыть гипотезы"><X aria-hidden="true" /></Button></DrawerClose>
          </div>
          <DrawerDescription>Выберите поведение выборки. Смена режима начинает новый прогон и обнуляет счётчики.</DrawerDescription>
        </DrawerHeader>
        <fieldset className="hypothesis-options">
          <legend className="sr-only">Режим выборки</legend>
          <ul>
            {selectionModes.map((option) => (
              <li key={option.id}>
                <label className={`hypothesis-option ${mode === option.id ? "hypothesis-selected" : ""}`}>
                  <input type="radio" name="selection-mode" value={option.id} checked={mode === option.id} onChange={() => onChange(option.id)} />
                  <span><strong>{option.label}</strong><span>{option.description}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </DrawerContent>
    </Drawer>
  );
}
