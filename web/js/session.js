import { fetchJSON, formatLapTime } from "./utils.js";
import { lapState, nextGeneration } from "./lapState.js";
import { zoomSyncState } from "./chartsCommon.js";
import { CHANNELS, loadChannel } from "./channelsPanel.js";
import { loadMap } from "./mapPanel.js";
import { loadGrip } from "./gripPanel.js";
import { loadSusp } from "./suspPanel.js";

const sessionSelect = document.getElementById("sessionSelect");
const lapSelect = document.getElementById("lapSelect");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

let currentSession = null; // response from /api/session

export function setStatus(text) {
  statusEl.textContent = text;
}

export async function loadFiles() {
  setStatus("Loading session list...");
  const files = await fetchJSON("/api/files");
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
  const info = await fetchJSON(`/api/session?file=${encodeURIComponent(file)}`);
  currentSession = info;

  const metaMap = {};
  for (const kv of info.metadata) metaMap[kv.key] = kv.value;

  const front = metaMap.TireCompoundFront;
  const rear = metaMap.TireCompoundRear;
  let compound = "-";
  if (front || rear) {
    compound = front === rear ? (front ?? rear) : `Front: ${front ?? "?"} / Rear: ${rear ?? "?"}`;
  }

  metaEl.innerHTML = `
    <span><b>Track:</b> ${metaMap.TrackName ?? "-"}</span>
    <span><b>Car:</b> ${metaMap.CarName ?? "-"}</span>
    <span><b>Class:</b> ${metaMap.CarClass ?? "-"}</span>
    <span><b>Session:</b> ${metaMap.SessionType ?? "-"}</span>
    <span><b>Driver:</b> ${metaMap.DriverName ?? "-"}</span>
    <span><b>Weather:</b> ${metaMap.WeatherConditions ?? "-"}</span>
    <span><b>Tire Compound:</b> ${compound}</span>
  `;

  lapSelect.innerHTML = "";
  const fullOpt = document.createElement("option");
  fullOpt.value = "full";
  fullOpt.textContent = "Full session";
  lapSelect.appendChild(fullOpt);

  for (const lap of info.laps) {
    const opt = document.createElement("option");
    opt.value = String(lap.lap);
    // "duration" is just wall-clock time between lap markers. Laps the game didn't count
    // (track-limit cuts, or the last lap if recording stopped mid-lap) never get an entry
    // in the "Lap Time" channel, so their time never became official - flag that here
    // instead of showing a number that looks like a real lap time but isn't one.
    opt.textContent = lap.valid
      ? `Lap ${lap.lap} (${formatLapTime(lap.duration)})`
      : `Lap ${lap.lap} (${formatLapTime(lap.duration)}, not counted)`;
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
  const myGeneration = nextGeneration();

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

  // Fetch the time->distance mapping first (map/grip cursor sync and the distance x-axis
  // mode both need it) so it's ready before the channels below use it.
  const distRows = await fetchJSON(
    `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("Lap Dist")}&start=${startTs}&end=${endTs}`
  );
  if (myGeneration !== lapState.loadGeneration) return; // a newer loadLap() call has already superseded this one
  let distPts = distRows.map((r) => ({ t: r.t - startTs, d: r.v }));
  if (lapValue === "full" || !lapValue) {
    // Full-session view: many genuine Lap Dist resets are expected throughout the window
    // (one per lap boundary) and must be preserved - only trim a stray sample the query's
    // rowid range (floor/ceil) can pull in just past the two edges.
    while (distPts.length > 1 && distPts[0].d > distPts[1].d) distPts.shift();
    while (distPts.length > 1 && distPts[distPts.length - 1].d < distPts[distPts.length - 2].d) distPts.pop();
  } else {
    // Single-lap view: Lap Dist should be purely non-decreasing across one lap, so any reset
    // inside the window is bleed from the adjacent lap. Usually that's one stray sample, but
    // the "Lap" event timestamp used as the query boundary doesn't always land exactly on Lap
    // Dist's own reset tick - on some laps that gap is several samples wide (observed: ~7
    // samples/0.7s on one lap where the in-game lap-change event lagged the distance reset),
    // so keep the longest non-decreasing run instead of assuming a single stray edge sample.
    let bestStart = 0, bestLen = 0, runStart = 0;
    for (let i = 1; i <= distPts.length; i++) {
      if (i === distPts.length || distPts[i].d < distPts[i - 1].d) {
        const len = i - runStart;
        if (len > bestLen) { bestLen = len; bestStart = runStart; }
        runStart = i;
      }
    }
    distPts = distPts.slice(bestStart, bestStart + bestLen);
  }
  lapState.distPoints = distPts;
  lapState.windowDuration = endTs - startTs;
  lapState.windowDistance = lapState.distPoints.length ? lapState.distPoints[lapState.distPoints.length - 1].d : 0;

  // Each channel resets its own zoom independently below, and resetZoom() fires the same
  // onZoomComplete callback a real user zoom does, which triggers syncZoomAcrossCharts.
  // Without this guard, chart A's reset can sync-force chart B's axis before chart B has
  // run its own reset - chart B's zoom plugin then sees its just-forced range as "already
  // correct", skips refreshing its cached original range, and gets permanently stuck
  // rejecting further zoom-out/reset attempts. Suppress cross-chart syncing for this bulk
  // per-lap reset; it's unneeded anyway since every channel here shares the same lap bounds.
  zoomSyncState.syncing = true;
  await Promise.all([
    ...CHANNELS.map((entry) => loadChannel(entry, file, startTs, endTs, myGeneration)),
    loadMap(file, startTs, endTs, myGeneration),
    loadGrip(file, startTs, endTs, myGeneration),
    loadSusp(file, startTs, endTs, myGeneration),
  ]);
  // A superseded call must not clear zoomSyncState.syncing out from under the newer load
  // that's still in flight, nor clobber the status text the newer load is about to set.
  if (myGeneration === lapState.loadGeneration) {
    zoomSyncState.syncing = false;
    setStatus("");
  }
}

sessionSelect.addEventListener("change", () => loadSession(sessionSelect.value));
lapSelect.addEventListener("change", () => loadLap(lapSelect.value));
