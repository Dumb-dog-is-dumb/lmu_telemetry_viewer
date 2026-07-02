export function formatLapTime(totalSeconds) {
  const totalMs = Math.round(totalSeconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}
