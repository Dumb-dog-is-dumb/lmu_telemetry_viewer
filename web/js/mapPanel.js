import { fetchJSON, nearestByKey } from "./utils.js";
import { lapState, distAtTime } from "./lapState.js";

// The game's "GPS Latitude/Longitude" channels are real angular degrees (verified against
// the game's own Total Dist channel), just centered on an arbitrary fake reference point
// rather than the track's real-world location. Standard degree->meter conversion applies.
const METERS_PER_DEG_LAT = 111320;

const SLOTS = ["A", "B"];
// Dataset index layout: 0/1/2 = slot A (line/start-finish/cursor, today's unchanged shape),
// 3/4/5 = slot B (same shape, colored via --accent-b). Both slots live in one Chart.js
// instance rather than two, so zoom/aspect-ratio bookkeeping isn't duplicated.
const DATASET_BASE = { A: 0, B: 3 };
const ACCENT_B = getComputedStyle(document.documentElement).getPropertyValue("--accent-b").trim() || "#ff8a3d";

let mapChart = null;
let currentMapPoints = { A: [], B: [] }; // slot -> [{x, y, t, d}] sorted by t

export function setMapCursor(slot, point) {
  if (!mapChart) return;
  mapChart.data.datasets[DATASET_BASE[slot] + 2].data = point ? [{ x: point.x, y: point.y }] : [];
  mapChart.update("none");
}

export function highlightMapAtX(slot, xVal) {
  if (currentMapPoints[slot].length === 0) return;
  setMapCursor(slot, nearestByKey(currentMapPoints[slot], lapState.xAxisMode === "distance" ? "d" : "t", xVal));
}

function lineDataset(slot, color) {
  return {
    label: `Racing line ${slot}`,
    data: [],
    borderColor: color,
    borderWidth: 2,
    borderDash: slot === "B" ? [8, 5] : undefined,
    pointRadius: 0,
    tension: 0,
  };
}

function startFinishDataset(slot) {
  return {
    type: "scatter",
    label: `Start/Finish ${slot}`,
    data: [],
    backgroundColor: "#f5c542",
    borderColor: "#14161a",
    borderWidth: 1,
    pointRadius: 5,
  };
}

function cursorDataset(slot, color) {
  return {
    type: "scatter",
    label: `Cursor ${slot}`,
    data: [],
    backgroundColor: slot === "A" ? "#ffffff" : color,
    borderColor: "#14161a",
    borderWidth: 2,
    pointRadius: 6,
  };
}

function ensureMapChart() {
  if (mapChart) return mapChart;
  const ctx = document.getElementById("chartMap").getContext("2d");
  mapChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        lineDataset("A", "#4fa8ff"),
        startFinishDataset("A"),
        cursorDataset("A", "#4fa8ff"),
        lineDataset("B", ACCENT_B),
        startFinishDataset("B"),
        cursorDataset("B", ACCENT_B),
      ],
    },
    options: {
      animation: false,
      parsing: false,
      normalized: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { type: "linear", display: false },
        y: { type: "linear", display: false },
      },
    },
  });
  return mapChart;
}

// Redraws from cached currentMapPoints without re-fetching - used both right after a fetch
// and when Compare is toggled back on for a slot that's already loaded in memory.
export function renderMap() {
  const chart = ensureMapChart();
  const active = SLOTS.filter((s) => (s === "A" || lapState.compareMode) && currentMapPoints[s].length > 0);
  for (const slot of SLOTS) {
    const base = DATASET_BASE[slot];
    const points = active.includes(slot) ? currentMapPoints[slot] : [];
    chart.data.datasets[base].data = points;
    chart.data.datasets[base + 1].data = points.length ? [points[0]] : [];
    chart.data.datasets[base + 2].data = []; // clear any cursor left over from the previous lap
  }
  if (active.length === 0) return;

  // Lock x/y to the same meters-per-pixel scale, based on the canvas's actual rendered
  // pixel size, so the track shape isn't stretched to fill a non-square panel. Bounding box
  // is the union across active slots so both fit when comparing (even across two different
  // tracks - overlaying unrelated tracks is only meaningful as a curiosity, but it's what
  // "overlay two racing lines" calls for).
  const xs = active.flatMap((s) => currentMapPoints[s].map((p) => p.x));
  const ys = active.flatMap((s) => currentMapPoints[s].map((p) => p.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dataW = Math.max(maxX - minX, 1);
  const dataH = Math.max(maxY - minY, 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const canvas = document.getElementById("chartMap");
  const rect = canvas.getBoundingClientRect();
  const pixelAspect = rect.width / rect.height || 1;

  const pad = 1.08; // 8% margin around the track
  let halfW = (dataW / 2) * pad;
  let halfH = (dataH / 2) * pad;
  if (halfW / halfH > pixelAspect) {
    halfH = halfW / pixelAspect;
  } else {
    halfW = halfH * pixelAspect;
  }

  chart.options.scales.x.min = cx - halfW;
  chart.options.scales.x.max = cx + halfW;
  chart.options.scales.y.min = cy - halfH;
  chart.options.scales.y.max = cy + halfH;
  chart.update();
}

export async function loadMap(slot, file, startTs, endTs, generation) {
  const [lonRows, latRows] = await Promise.all([
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("GPS Longitude")}&start=${startTs}&end=${endTs}`),
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("GPS Latitude")}&start=${startTs}&end=${endTs}`),
  ]);
  if (generation !== lapState.generation[slot]) return; // superseded by a newer loadLap() call

  const n = Math.min(lonRows.length, latRows.length);
  if (n === 0) return;

  let sumLat = 0;
  for (let i = 0; i < n; i++) sumLat += latRows[i].v;
  const meanLat = sumLat / n;
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);

  const lon0 = lonRows[0].v;
  const lat0 = latRows[0].v;
  const points = [];
  for (let i = 0; i < n; i++) {
    const t = lonRows[i].t - startTs;
    points.push({
      x: (lonRows[i].v - lon0) * metersPerDegLon,
      y: (latRows[i].v - lat0) * METERS_PER_DEG_LAT,
      t,
      d: distAtTime(slot, t),
    });
  }
  currentMapPoints[slot] = points;
  renderMap();
}
