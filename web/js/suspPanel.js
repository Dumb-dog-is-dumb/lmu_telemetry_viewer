import { fetchJSON, nearestByKey } from "./utils.js";
import { lapState, distAtTime } from "./lapState.js";

const SLOTS = ["A", "B"];
const SUSP_WHEELS = ["fl", "fr", "rl", "rr"];
let currentSuspPoints = { A: [], B: [] }; // slot -> [{t, d, fl, fr, rl, rr}] sorted by t, values in mm
let suspRangeBySlot = { A: { min: 0, max: 1 }, B: { min: 0, max: 1 } };

const suspEls = {};
for (const w of SUSP_WHEELS) {
  const el = document.querySelector(`.susp-wheel[data-wheel="${w}"]`);
  suspEls[w] = {
    A: { value: el.querySelector(".susp-value-a"), fill: el.querySelector(".susp-bar-fill-a") },
    B: { value: el.querySelector(".susp-value-b"), fill: el.querySelector(".susp-bar-fill-b") },
  };
}

// While comparing, both slots share one min/max range so bar heights stay directly
// comparable - independent per-slot scaling could make a taller bar mean nothing more than
// a different scale.
function activeRange() {
  if (!lapState.compareMode || currentSuspPoints.B.length === 0) return suspRangeBySlot.A;
  return {
    min: Math.min(suspRangeBySlot.A.min, suspRangeBySlot.B.min),
    max: Math.max(suspRangeBySlot.A.max, suspRangeBySlot.B.max),
  };
}

export function setSuspCursor(slot, point) {
  const range = activeRange();
  for (const w of SUSP_WHEELS) {
    const { value, fill } = suspEls[w][slot];
    if (!point) {
      value.textContent = "-";
      fill.style.height = "0%";
      continue;
    }
    const v = point[w];
    value.textContent = v.toFixed(1);
    const span = range.max - range.min || 1;
    const pct = Math.min(100, Math.max(0, ((v - range.min) / span) * 100));
    fill.style.height = `${pct}%`;
  }
}

export function highlightSuspAtX(slot, xVal) {
  if (currentSuspPoints[slot].length === 0) return;
  setSuspCursor(slot, nearestByKey(currentSuspPoints[slot], lapState.xAxisMode === "distance" ? "d" : "t", xVal));
}

// Resets both slots to their lap-start values from cached state without re-fetching - used
// when Compare is toggled (on: shows slot B's cached data and refreshes slot A's bar scale
// to the new shared range; off: hides slot B's cursor).
export function renderSusp() {
  for (const slot of SLOTS) {
    const active = (slot === "A" || lapState.compareMode) && currentSuspPoints[slot].length > 0;
    setSuspCursor(slot, active ? currentSuspPoints[slot][0] : null);
  }
}

export async function loadSusp(slot, file, startTs, endTs, generation) {
  const rows = await fetchJSON(
    `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("Susp Pos")}&start=${startTs}&end=${endTs}`
  );
  if (generation !== lapState.generation[slot]) return; // superseded by a newer loadLap() call
  if (rows.length === 0) return;

  let min = Infinity;
  let max = -Infinity;
  const points = rows.map((r) => {
    const t = r.t - startTs;
    const point = { t, d: distAtTime(slot, t) };
    for (const w of SUSP_WHEELS) {
      const mm = r[w] * 1000; // meters -> mm
      point[w] = mm;
      if (mm < min) min = mm;
      if (mm > max) max = mm;
    }
    return point;
  });
  currentSuspPoints[slot] = points;
  const pad = (max - min) * 0.1 || 1;
  suspRangeBySlot[slot] = { min: min - pad, max: max + pad };
  setSuspCursor(slot, points[0]); // shows lap-start values until hover moves it
}
