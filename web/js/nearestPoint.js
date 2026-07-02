// Shared by the map and grip-circle panels, which both track "which sampled
// point is nearest the hovered time" over a points array sorted by t.
export function nearestPointAtTime(points, tSec) {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (tSec <= points[lo].t) return points[lo];
  if (tSec >= points[hi].t) return points[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < tSec) lo = mid;
    else hi = mid;
  }
  return tSec - points[lo].t < points[hi].t - tSec ? points[lo] : points[hi];
}
