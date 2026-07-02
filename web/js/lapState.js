// Shared state describing the currently loaded lap(s)/window, plus the time->distance mapping
// used to sync the map/grip/suspension cursors and the optional distance x-axis. Read by
// every panel module (channels/map/grip/susp) and written by session.js as each lap loads.
//
// Two independent "slots" (A and B) support comparing two laps - possibly from different
// sessions - side by side. Slot A alone (compareMode false) reproduces the single-lap
// behavior this app had before comparison was added; slot B is only populated/rendered once
// Compare is toggled on.
export const lapState = {
  xAxisMode: "time", // "time" | "distance"
  compareMode: false,
  generation: { A: 0, B: 0 },
  slots: {
    // [{t, d}] sorted by t ascending, from the "Lap Dist" channel (10Hz, meters, resets to 0
    // at each lap start), for the currently loaded window - one per slot.
    A: { distPoints: [], windowDuration: 0, windowDistance: 0 },
    B: { distPoints: [], windowDuration: 0, windowDistance: 0 },
  },
};

// Bumped at the start of every loadLap(slot, ...) call, independently per slot. Async work
// from a superseded call checks its captured generation against lapState.generation[slot]
// before writing shared state - without this, a slow-to-resolve fetch from an old lap can
// land after a newer lap's fetches already updated the distance mapping, so old (long) time
// values get clamped by distAtTime() against the new (short) lap's range and pile up at one
// edge. Only reproduces in distance mode since time mode never calls distAtTime(). Split per
// slot so switching Lap A and Lap B independently can't have one slot's stale fetch guarded
// by the other slot's generation counter.
export function nextGeneration(slot) {
  return ++lapState.generation[slot];
}

export function distAtTime(slot, tSec) {
  const pts = lapState.slots[slot].distPoints;
  if (pts.length === 0) return 0;
  let lo = 0;
  let hi = pts.length - 1;
  if (tSec <= pts[lo].t) return pts[lo].d;
  if (tSec >= pts[hi].t) return pts[hi].d;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t < tSec) lo = mid;
    else hi = mid;
  }
  const t0 = pts[lo].t, t1 = pts[hi].t;
  const d0 = pts[lo].d, d1 = pts[hi].d;
  if (t1 === t0) return d0;
  return d0 + ((tSec - t0) / (t1 - t0)) * (d1 - d0);
}

export function xValueFor(slot, tRel) {
  return lapState.xAxisMode === "distance" ? distAtTime(slot, tRel) : tRel;
}

// Chart x-axis max: the loaded slot's own window when only slot A is active, or the larger
// of the two windows when comparing, so neither lap's data gets clipped.
export function windowMax() {
  const active = lapState.compareMode ? ["A", "B"] : ["A"];
  const key = lapState.xAxisMode === "distance" ? "windowDistance" : "windowDuration";
  return Math.max(...active.map((s) => lapState.slots[s][key]));
}
