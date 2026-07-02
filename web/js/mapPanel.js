import { fetchJSON, nearestByKey } from "./utils.js";
import { lapState, distAtTime } from "./lapState.js";

// The game's "GPS Latitude/Longitude" channels are real angular degrees (verified against
// the game's own Total Dist channel), just centered on an arbitrary fake reference point
// rather than the track's real-world location. Standard degree->meter conversion applies.
const METERS_PER_DEG_LAT = 111320;

let mapChart = null;
let currentMapPoints = []; // [{x, y, t}] sorted by t (t = seconds since lap start)

export function setMapCursor(point) {
  if (!mapChart) return;
  mapChart.data.datasets[2].data = point ? [{ x: point.x, y: point.y }] : [];
  mapChart.update("none");
}

export function highlightMapAtX(xVal) {
  if (currentMapPoints.length === 0) return;
  setMapCursor(nearestByKey(currentMapPoints, lapState.xAxisMode === "distance" ? "d" : "t", xVal));
}

function ensureMapChart() {
  if (mapChart) return mapChart;
  const ctx = document.getElementById("chartMap").getContext("2d");
  mapChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Racing line",
          data: [],
          borderColor: "#4fa8ff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          type: "scatter",
          label: "Start/Finish",
          data: [],
          backgroundColor: "#f5c542",
          borderColor: "#14161a",
          borderWidth: 1,
          pointRadius: 5,
        },
        {
          type: "scatter",
          label: "Cursor",
          data: [],
          backgroundColor: "#ffffff",
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
        x: { type: "linear", display: false },
        y: { type: "linear", display: false },
      },
    },
  });
  return mapChart;
}

export async function loadMap(file, startTs, endTs, generation) {
  const [lonRows, latRows] = await Promise.all([
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("GPS Longitude")}&start=${startTs}&end=${endTs}`),
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("GPS Latitude")}&start=${startTs}&end=${endTs}`),
  ]);
  if (generation !== lapState.loadGeneration) return; // superseded by a newer loadLap() call

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
      d: distAtTime(t),
    });
  }
  currentMapPoints = points;

  const chart = ensureMapChart();
  chart.data.datasets[0].data = points;
  chart.data.datasets[1].data = [points[0]];
  chart.data.datasets[2].data = []; // clear any cursor left over from the previous lap

  // Lock x/y to the same meters-per-pixel scale, based on the canvas's actual rendered
  // pixel size, so the track shape isn't stretched to fill a non-square panel.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
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
