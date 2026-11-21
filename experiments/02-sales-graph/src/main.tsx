import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LabApp } from "./LabApp.tsx";
import { initialEmployeeScreen } from "./Employees.tsx";
import "@xyflow/react/dist/style.css";
import "./theme.css";
import "./styles.css";
import "./lab.css";
const employeeScreen = initialEmployeeScreen();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LabApp employeeScreen={employeeScreen} />
  </StrictMode>,
);
