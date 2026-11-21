import { benchmarkBuild } from "./employees/build-info.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { parseArgs } from "node:util";
import { engines, graphVariants } from "./employees/engine.ts";
import type { Engine } from "./employees/engine.ts";
import { predict, validateForecast } from "./employees/forecast.ts";
import { parseRecording } from "./employees/import.ts";
import { profileLabels, preset, sizes } from "./employees/recording.ts";
import type { Profile, Size } from "./employees/recording.ts";
import { extended, pilot, runArchitectureSeries, runSeries } from "./employees/series.ts";

const { values } = parseArgs({
  options: {
    engine: { type: "string", default: "preact" },
    profile: { type: "string", default: "editing" },
    size: { type: "string", default: "1000" },
    seed: { type: "string", default: "42" },
    session: { type: "string", default: "0" },
    threshold: { type: "string", default: "0.05" },
    input: { type: "string" }, out: { type: "string" },
    extended: { type: "boolean" },
    graph: { type: "string", default: "A" },
    architecture: { type: "boolean" },
    "forecast-out": { type: "string" },
  },
});
const { engine, profile } = values;
const size = Number(values.size);
const seed = Number(values.seed);
const session = Number(values.session);
if (!engines.some((entry) => entry === engine) || !Object.hasOwn(profileLabels, profile) ||
  !sizes.some((entry) => entry === size) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
  !Number.isInteger(session) || session < 0 || session > 1_000) {
  throw new Error("Проверьте --engine, --profile, --size (100, 1000, 10000), --seed и --session.");
}
const recording = values.input
  ? parseRecording(JSON.parse(readFileSync(values.input, "utf8")))
  : preset(profile as Profile, size as Size, seed, session);
const graph = graphVariants.find((item) => item === values.graph);
if (!graph) throw new Error("--graph принимает A или B.");
const forecastPath = values["forecast-out"];
if (forecastPath && (values.input || values.architecture || forecastPath === values.out)) {
  throw new Error("--forecast-out использует два пресета и отдельный файл прогноза.");
}
const currentEngine = engine as Engine;
const build = "CLI TypeScript · " + benchmarkBuild();
const parameters = {
  ...(values.extended ? extended : pilot), threshold: Number(values.threshold),
};
const environment = {
  runtime: "node" as const,
  details: [process.version, process.versions.v8, platform(), release(), arch(), cpus()[0]?.model].join(" · "),
  build,
};
let report;
if (values.architecture) {
  report = await runArchitectureSeries(recording, currentEngine, parameters, environment);
} else if (forecastPath) {
  const holdout = preset(profile as Profile, size as Size, seed, session + 1);
  const forecast = predict(recording, currentEngine, parameters.threshold, graph);
  writeFileSync(forecastPath, JSON.stringify({ forecast, holdout }, null, 2) + "\n");
  const validation = await runSeries(holdout, currentEngine, parameters, environment, { graph });
  report = { ...validation, forecastValidation: validateForecast(forecast, validation) };
} else {
  report = await runSeries(recording, currentEngine, parameters, environment, { graph });
}
const json = JSON.stringify(report, null, 2) + "\n";
if (values.out) writeFileSync(values.out, json);
else process.stdout.write(json);
if (Object.values(report.diagnostics).some((item) => !item.valid)) process.exitCode = 1;
