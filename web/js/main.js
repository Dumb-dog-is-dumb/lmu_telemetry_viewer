import { getFiles, getSession } from "./api.js";
import { formatLapTime } from "./format.js";
import { loadTimeSeriesCharts, resetAllZoom } from "./timeSeriesCharts.js";
import { loadMap } from "./mapChart.js";
import { loadGrip } from "./gripChart.js";

Chart.register(ChartZoom);

const sessionSelect = document.getElementById("sessionSelect");
const lapSelect = document.getElementById("lapSelect");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

let currentSession = null; // response from /api/session

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadFiles() {
  setStatus("Loading session list...");
  const files = await getFiles();
  sessionSelect.innerHTML = "";
  if (files.length === 0) {
    sessionSelect.innerHTML = "<option>No telemetry files found</option>";
    setStatus("No .duckdb telemetry files found.");
    return;
  }
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f.file;
    const when = new Date(f.sessionTime).toLocaleString();
    const car = f.car ? ` — ${f.car}` : "";
    const fastLap = f.fastestLap != null ? ` — best lap ${formatLapTime(f.fastestLap)}` : "";
    opt.textContent = `${f.track} — ${f.sessionType || "?"} — ${when}${car}${fastLap}`;
    sessionSelect.appendChild(opt);
  }
  setStatus("");
  await loadSession(sessionSelect.value);
}

async function loadSession(file) {
  if (!file) return;
  setStatus("Loading session info...");
  const info = await getSession(file);
  currentSession = info;

  const metaMap = {};
  for (const kv of info.metadata) metaMap[kv.key] = kv.value;
  metaEl.innerHTML = `
    <span><b>Track:</b> ${metaMap.TrackName ?? "-"}</span>
    <span><b>Car:</b> ${metaMap.CarName ?? "-"}</span>
    <span><b>Session:</b> ${metaMap.SessionType ?? "-"}</span>
    <span><b>Driver:</b> ${metaMap.DriverName ?? "-"}</span>
    <span><b>Weather:</b> ${metaMap.WeatherConditions ?? "-"}</span>
  `;

  lapSelect.innerHTML = "";
  const fullOpt = document.createElement("option");
  fullOpt.value = "full";
  fullOpt.textContent = "Full session";
  lapSelect.appendChild(fullOpt);

  for (const lap of info.laps) {
    const opt = document.createElement("option");
    opt.value = String(lap.lap);
    opt.textContent = `Lap ${lap.lap} (${formatLapTime(lap.duration)})`;
    lapSelect.appendChild(opt);
  }

  if (info.laps.length > 0) {
    lapSelect.value = String(info.laps[info.laps.length - 1].lap);
  }

  setStatus("");
  await loadLap(lapSelect.value, file);
}

async function loadLap(lapValue, file) {
  if (!currentSession) return;
  file = file || sessionSelect.value;

  let startTs, endTs;
  if (lapValue === "full" || !lapValue) {
    startTs = currentSession.t0;
    endTs = currentSession.sessionEnd;
  } else {
    const lap = currentSession.laps.find((l) => String(l.lap) === String(lapValue));
    if (!lap) return;
    startTs = lap.startTs;
    endTs = lap.endTs;
  }

  setStatus("Loading telemetry...");
  await Promise.all([
    loadTimeSeriesCharts(file, startTs, endTs),
    loadMap(file, startTs, endTs),
    loadGrip(file, startTs, endTs),
  ]);
  setStatus("");
}

sessionSelect.addEventListener("change", () => loadSession(sessionSelect.value));
lapSelect.addEventListener("change", () => loadLap(lapSelect.value));
document.getElementById("resetZoomBtn").addEventListener("click", resetAllZoom);

loadFiles().catch((err) => setStatus("Error: " + err.message));
