// Generic helpers with no dependency on app state - safe to reuse from any panel.

export async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function formatLapTime(totalSeconds) {
  const totalMs = Math.round(totalSeconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// Binary search for the point nearest `value` under the given key ("t" or "d"), assuming
// `points` is sorted ascending by that key (true for a single lap; may degrade near lap
// resets in "distance" mode when viewing the full session, since Lap Dist isn't globally
// monotonic there).
export function nearestByKey(points, key, value) {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (value <= points[lo][key]) return points[lo];
  if (value >= points[hi][key]) return points[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][key] < value) lo = mid;
    else hi = mid;
  }
  return value - points[lo][key] < points[hi][key] - value ? points[lo] : points[hi];
}
