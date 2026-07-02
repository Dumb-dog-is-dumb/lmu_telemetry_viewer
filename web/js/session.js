import { fetchJSON, formatLapTime } from "./utils.js";
import { lapState, nextGeneration } from "./lapState.js";
import { zoomSyncState } from "./chartsCommon.js";
import { CHANNELS, loadChannel, renderAllChannels } from "./channelsPanel.js";
import { loadMap, renderMap } from "./mapPanel.js";
import { loadGrip, renderGrip } from "./gripPanel.js";
import { loadSusp, renderSusp } from "./suspPanel.js";
import { openSessionTable } from "./sessionTable.js";

const sel = {
  A: { session: document.getElementById("sessionSelect"), lap: document.getElementById("lapSelect") },
  B: { session: document.getElementById("sessionSelectB"), lap: document.getElementById("lapSelectB") },
};
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const compareToggle = document.getElementById("compareToggle");
const compareBPickers = document.getElementById("compareBPickers");
const suspBEls = document.querySelectorAll(".susp-value-b, .susp-bar-fill-b");

let currentSession = { A: null, B: null }; // response from /api/session, per slot
// /api/files result, cached module-locally so toggling Compare or opening the session table
// doesn't re-fetch it.
let filesCache = null;

export function setStatus(text) {
  statusEl.textContent = text;
}

export function getFiles() {
  return filesCache;
}

function populateSessionSelect(selectEl, files) {
  selectEl.innerHTML = "";
  if (files.length === 0) {
    selectEl.innerHTML = "<option>No telemetry files found</option>";
    return;
  }
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f.file;
    const when = new Date(f.sessionTime).toLocaleString();
    const car = f.car ? ` — ${f.car}` : "";
    const fastLap = f.fastestLap != null ? ` — best lap ${formatLapTime(f.fastestLap)}` : "";
    opt.textContent = `${f.track} — ${f.sessionType || "?"} — ${when}${car}${fastLap}`;
    selectEl.appendChild(opt);
  }
}

export async function loadFiles() {
  setStatus("Loading session list...");
  const files = await fetchJSON("/api/files");
  filesCache = files;
  populateSessionSelect(sel.A.session, files);
  if (files.length === 0) {
    setStatus("No .duckdb telemetry files found.");
    return;
  }
  setStatus("");
  await loadSession("A", sel.A.session.value);
}

function metaRowHtml(info, label) {
  if (!info) return "";
  const metaMap = {};
  for (const kv of info.metadata) metaMap[kv.key] = kv.value;

  const front = metaMap.TireCompoundFront;
  const rear = metaMap.TireCompoundRear;
  let compound = "-";
  if (front || rear) {
    compound = front === rear ? (front ?? rear) : `Front: ${front ?? "?"} / Rear: ${rear ?? "?"}`;
  }

  const rowClass = label ? ` meta-row-${label.toLowerCase()}` : "";
  const labelHtml = label ? `<span class="meta-row-label">${label}:</span>` : "";
  return `
    <div class="meta-row${rowClass}">
      ${labelHtml}
      <span><b>Track:</b> ${metaMap.TrackName ?? "-"}</span>
      <span><b>Car:</b> ${metaMap.CarName ?? "-"}</span>
      <span><b>Class:</b> ${metaMap.CarClass ?? "-"}</span>
      <span><b>Session:</b> ${metaMap.SessionType ?? "-"}</span>
      <span><b>Driver:</b> ${metaMap.DriverName ?? "-"}</span>
      <span><b>Weather:</b> ${metaMap.WeatherConditions ?? "-"}</span>
      <span><b>Tire Compound:</b> ${compound}</span>
    </div>`;
}

function renderMeta() {
  if (!lapState.compareMode) {
    metaEl.classList.remove("compare");
    metaEl.innerHTML = metaRowHtml(currentSession.A, null);
    return;
  }
  metaEl.classList.add("compare");
  metaEl.innerHTML = metaRowHtml(currentSession.A, "A") + metaRowHtml(currentSession.B, "B");
}

async function loadSession(slot, file) {
  if (!file) return;
  setStatus("Loading session info...");
  const info = await fetchJSON(`/api/session?file=${encodeURIComponent(file)}`);
  currentSession[slot] = info;
  renderMeta();

  const lapSel = sel[slot].lap;
  lapSel.innerHTML = "";
  const fullOpt = document.createElement("option");
  fullOpt.value = "full";
  fullOpt.textContent = "Full session";
  lapSel.appendChild(fullOpt);

  for (const lap of info.laps) {
    const opt = document.createElement("option");
    opt.value = String(lap.lap);
    // See loadLap()'s startTs/endTs comment for why "officialTime" (not "duration") is
    // preferred for display.
    opt.textContent = lap.valid
      ? `Lap ${lap.lap} (${formatLapTime(lap.officialTime)})`
      : `Lap ${lap.lap} (${formatLapTime(lap.duration)}, not counted)`;
    lapSel.appendChild(opt);
  }

  if (info.laps.length > 0) {
    lapSel.value = String(info.laps[info.laps.length - 1].lap);
  }

  setStatus("");
  await loadLap(slot, lapSel.value, file);
}

async function loadLap(slot, lapValue, file) {
  if (!currentSession[slot]) return;
  file = file || sel[slot].session.value;
  const myGeneration = nextGeneration(slot);

  let startTs, endTs;
  if (lapValue === "full" || !lapValue) {
    startTs = currentSession[slot].t0;
    endTs = currentSession[slot].sessionEnd;
  } else {
    const lap = currentSession[slot].laps.find((l) => String(l.lap) === String(lapValue));
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
  if (myGeneration !== lapState.generation[slot]) return; // a newer loadLap() call has already superseded this one
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
  lapState.slots[slot].distPoints = distPts;
  lapState.slots[slot].windowDuration = endTs - startTs;
  lapState.slots[slot].windowDistance = distPts.length ? distPts[distPts.length - 1].d : 0;

  // Each channel resets its own zoom independently below, and resetZoom() fires the same
  // onZoomComplete callback a real user zoom does, which triggers syncZoomAcrossCharts.
  // Without this guard, chart A's reset can sync-force chart B's axis before chart B has
  // run its own reset - chart B's zoom plugin then sees its just-forced range as "already
  // correct", skips refreshing its cached original range, and gets permanently stuck
  // rejecting further zoom-out/reset attempts. Suppress cross-chart syncing for this bulk
  // per-lap reset; it's unneeded anyway since every channel here shares the same lap bounds.
  zoomSyncState.syncing = true;
  await Promise.all([
    ...CHANNELS.map((entry) => loadChannel(entry, slot, file, startTs, endTs, myGeneration)),
    loadMap(slot, file, startTs, endTs, myGeneration),
    loadGrip(slot, file, startTs, endTs, myGeneration),
    loadSusp(slot, file, startTs, endTs, myGeneration),
  ]);
  // A superseded call must not clear zoomSyncState.syncing out from under the newer load
  // that's still in flight, nor clobber the status text the newer load is about to set.
  if (myGeneration === lapState.generation[slot]) {
    zoomSyncState.syncing = false;
    setStatus("");
  }
}

function setCompareVisible(visible) {
  compareBPickers.hidden = !visible;
  for (const el of suspBEls) el.hidden = !visible;
}

compareToggle.addEventListener("change", async () => {
  lapState.compareMode = compareToggle.checked;
  setCompareVisible(lapState.compareMode);

  if (lapState.compareMode && !currentSession.B) {
    // First time enabling Compare: default slot B to the currently loaded slot-A session -
    // comparing two laps within the same session is the common case.
    if (filesCache) populateSessionSelect(sel.B.session, filesCache);
    sel.B.session.value = sel.A.session.value;
    await loadSession("B", sel.B.session.value);
  } else {
    // Either turning Compare off, or back on with slot B already cached in lapState/
    // currentSession from an earlier toggle - just re-render from cached state, no re-fetch.
    renderAllChannels();
    renderMap();
    renderGrip();
    renderSusp();
    renderMeta();
  }
});

for (const btn of document.querySelectorAll(".browse-btn")) {
  btn.addEventListener("click", () => openSessionTable(btn.dataset.target));
}

// Used by sessionTable.js when a row is picked, so it drives the same select+change path a
// manual dropdown pick would.
export function selectSession(slot, file) {
  const selectEl = sel[slot].session;
  if (selectEl.value === file) {
    // A `<select>` doesn't fire "change" when set to its current value - load explicitly.
    loadSession(slot, file);
    return;
  }
  selectEl.value = file;
  selectEl.dispatchEvent(new Event("change"));
}

sel.A.session.addEventListener("change", () => loadSession("A", sel.A.session.value));
sel.A.lap.addEventListener("change", () => loadLap("A", sel.A.lap.value));
sel.B.session.addEventListener("change", () => loadSession("B", sel.B.session.value));
sel.B.lap.addEventListener("change", () => loadLap("B", sel.B.lap.value));
