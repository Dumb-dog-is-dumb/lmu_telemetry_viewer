// Shared state describing the currently loaded lap/window, plus the time->distance mapping
// used to sync the map/grip/suspension cursors and the optional distance x-axis. Read by
// every panel module (channels/map/grip/susp) and written by session.js as each lap loads.
export const lapState = {
  xAxisMode: "time", // "time" | "distance"
  loadGeneration: 0,
  // [{t, d}] sorted by t ascending, from the "Lap Dist" channel (10Hz, meters, resets to 0
  // at each lap start), for the currently loaded window.
  distPoints: [],
  windowDuration: 0, // seconds, end-start of the loaded window
  windowDistance: 0, // meters, Lap Dist value at the end of the loaded window
};

// Bumped at the start of every loadLap() call. Async work from a superseded call checks its
// captured generation against lapState.loadGeneration before writing shared state - without
// this, a slow-to-resolve fetch from an old lap can land after a newer lap's fetches already
// updated the distance mapping, so old (long) time values get clamped by distAtTime() against
// the new (short) lap's range and pile up at one edge. Only reproduces in distance mode since
// time mode never calls distAtTime().
export function nextGeneration() {
  return ++lapState.loadGeneration;
}

export function distAtTime(tSec) {
  const pts = lapState.distPoints;
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

export function xValueFor(tRel) {
  return lapState.xAxisMode === "distance" ? distAtTime(tRel) : tRel;
}
