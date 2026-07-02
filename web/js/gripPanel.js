import { fetchJSON, nearestByKey } from "./utils.js";
import { lapState, distAtTime } from "./lapState.js";

const SLOTS = ["A", "B"];
const ACCENT_B = getComputedStyle(document.documentElement).getPropertyValue("--accent-b").trim() || "#ff8a3d";

let gripChart = null;
let currentGripPoints = { A: [], B: [] }; // slot -> [{x: lateralG, y: longitudinalG, t, d}]
let maxMag = { A: 0, B: 0 };

function circlePoints(radius, segments = 64) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return pts;
}

// Dataset index layout: 0/1 = shared reference circles (half-grip/max-grip, just visual
// guides, not per-lap data), 2 = cursor A (unchanged), 3 = cursor B (new).
export function setGripCursor(slot, point) {
  if (!gripChart) return;
  const idx = slot === "A" ? 2 : 3;
  gripChart.data.datasets[idx].data = point ? [{ x: point.x, y: point.y }] : [];
  gripChart.update("none");
}

export function highlightGripAtX(slot, xVal) {
  if (currentGripPoints[slot].length === 0) return;
  setGripCursor(slot, nearestByKey(currentGripPoints[slot], lapState.xAxisMode === "distance" ? "d" : "t", xVal));
}

function ensureGripChart() {
  if (gripChart) return gripChart;
  const ctx = document.getElementById("chartGrip").getContext("2d");
  gripChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Half grip",
          data: [],
          showLine: true,
          borderColor: "#5b6472",
          borderDash: [4, 4],
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          label: "Max grip",
          data: [],
          showLine: true,
          borderColor: "#5b6472",
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          label: "Cursor A",
          data: [],
          backgroundColor: "#ffffff",
          borderColor: "#14161a",
          borderWidth: 2,
          pointRadius: 6,
        },
        {
          label: "Cursor B",
          data: [],
          backgroundColor: ACCENT_B,
          borderColor: "#14161a",
          borderWidth: 2,
          pointRadius: 6,
        },
      ],
    },
    options: {
      animation: false,
      parsing: false,
      normalized: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Lateral G" },
          grid: { color: "#363c46" },
          ticks: { color: "#9aa2ad" },
        },
        y: {
          type: "linear",
          title: { display: true, text: "Longitudinal G (accel + / brake −)" },
          grid: { color: "#363c46" },
          ticks: { color: "#9aa2ad" },
        },
      },
    },
  });
  return gripChart;
}

// Redraws reference circles + lap-start cursor from cached state without re-fetching - used
// both right after a fetch and when Compare is toggled back on for an already-loaded slot.
export function renderGrip() {
  const chart = ensureGripChart();
  const active = SLOTS.filter((s) => (s === "A" || lapState.compareMode) && currentGripPoints[s].length > 0);
  if (active.length === 0) return;

  const niceMax = Math.max(0.5, Math.ceil(Math.max(...active.map((s) => maxMag[s])) * 2) / 2);
  chart.data.datasets[0].data = circlePoints(niceMax / 2);
  chart.data.datasets[1].data = circlePoints(niceMax);
  for (const slot of SLOTS) {
    const idx = slot === "A" ? 2 : 3;
    // shows lap-start point until hover moves it
    chart.data.datasets[idx].data = active.includes(slot) ? [{ x: currentGripPoints[slot][0].x, y: currentGripPoints[slot][0].y }] : [];
  }

  const canvas = document.getElementById("chartGrip");
  const rect = canvas.getBoundingClientRect();
  const pixelAspect = rect.width / rect.height || 1;
  let halfW = niceMax * 1.1;
  let halfH = niceMax * 1.1;
  if (halfW / halfH > pixelAspect) halfH = halfW / pixelAspect;
  else halfW = halfH * pixelAspect;

  chart.options.scales.x.min = -halfW;
  chart.options.scales.x.max = halfW;
  chart.options.scales.y.min = -halfH;
  chart.options.scales.y.max = halfH;
  chart.update();
}

export async function loadGrip(slot, file, startTs, endTs, generation) {
  const [latRows, longRows] = await Promise.all([
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("G Force Lat")}&start=${startTs}&end=${endTs}`),
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("G Force Long")}&start=${startTs}&end=${endTs}`),
  ]);
  if (generation !== lapState.generation[slot]) return; // superseded by a newer loadLap() call

  const n = Math.min(latRows.length, longRows.length);
  if (n === 0) return;

  let mag = 0;
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = latRows[i].v;
    const y = longRows[i].v;
    const t = latRows[i].t - startTs;
    points.push({ x, y, t, d: distAtTime(slot, t) });
    mag = Math.max(mag, Math.sqrt(x * x + y * y));
  }
  currentGripPoints[slot] = points;
  maxMag[slot] = mag;
  renderGrip();
}
