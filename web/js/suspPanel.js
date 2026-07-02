import { fetchJSON, nearestByKey } from "./utils.js";
import { lapState, distAtTime } from "./lapState.js";

const SUSP_WHEELS = ["fl", "fr", "rl", "rr"];
let currentSuspPoints = []; // [{t, d, fl, fr, rl, rr}] sorted by t, values in mm
let suspRange = { min: 0, max: 1 }; // shared scale across all 4 wheels for this lap

const suspEls = {};
for (const w of SUSP_WHEELS) {
  const el = document.querySelector(`.susp-wheel[data-wheel="${w}"]`);
  suspEls[w] = { value: el.querySelector(".susp-value"), fill: el.querySelector(".susp-bar-fill") };
}

export function setSuspCursor(point) {
  for (const w of SUSP_WHEELS) {
    const { value, fill } = suspEls[w];
    if (!point) {
      value.textContent = "-";
      fill.style.height = "0%";
      continue;
    }
    const v = point[w];
    value.textContent = v.toFixed(1);
    const span = suspRange.max - suspRange.min || 1;
    const pct = Math.min(100, Math.max(0, ((v - suspRange.min) / span) * 100));
    fill.style.height = `${pct}%`;
  }
}

export function highlightSuspAtX(xVal) {
  if (currentSuspPoints.length === 0) return;
  setSuspCursor(nearestByKey(currentSuspPoints, lapState.xAxisMode === "distance" ? "d" : "t", xVal));
}

export async function loadSusp(file, startTs, endTs, generation) {
  const rows = await fetchJSON(
    `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("Susp Pos")}&start=${startTs}&end=${endTs}`
  );
  if (generation !== lapState.loadGeneration) return; // superseded by a newer loadLap() call
  if (rows.length === 0) return;

  let min = Infinity;
  let max = -Infinity;
  const points = rows.map((r) => {
    const t = r.t - startTs;
    const point = { t, d: distAtTime(t) };
    for (const w of SUSP_WHEELS) {
      const mm = r[w] * 1000; // meters -> mm
      point[w] = mm;
      if (mm < min) min = mm;
      if (mm > max) max = mm;
    }
    return point;
  });
  currentSuspPoints = points;
  const pad = (max - min) * 0.1 || 1;
  suspRange = { min: min - pad, max: max + pad };
  setSuspCursor(points[0]); // shows lap-start values until hover moves it
}
