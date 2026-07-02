import { getChannel } from "./api.js";
import { onCursorMove } from "./cursorSync.js";
import { nearestPointAtTime } from "./nearestPoint.js";

let gripChart = null;
let currentGripPoints = []; // [{x: lateralG, y: longitudinalG, t}] sorted by t

function circlePoints(radius, segments = 64) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return pts;
}

function setGripCursor(point) {
  if (!gripChart) return;
  gripChart.data.datasets[2].data = point ? [{ x: point.x, y: point.y }] : [];
  gripChart.update("none");
}

onCursorMove((tSec) => {
  if (tSec == null || currentGripPoints.length === 0) return setGripCursor(null);
  setGripCursor(nearestPointAtTime(currentGripPoints, tSec));
});

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
          borderColor: "#2c313a",
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
        },
        {
          label: "Max grip",
          data: [],
          showLine: true,
          borderColor: "#2c313a",
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
        },
        {
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
        x: {
          type: "linear",
          title: { display: true, text: "Lateral G" },
          grid: { color: "#2c313a" },
          ticks: { color: "#9aa2ad" },
        },
        y: {
          type: "linear",
          title: { display: true, text: "Longitudinal G (accel + / brake −)" },
          grid: { color: "#2c313a" },
          ticks: { color: "#9aa2ad" },
        },
      },
    },
  });
  return gripChart;
}

export async function loadGrip(file, startTs, endTs) {
  const [latRows, longRows] = await Promise.all([
    getChannel(file, "G Force Lat", startTs, endTs),
    getChannel(file, "G Force Long", startTs, endTs),
  ]);

  const n = Math.min(latRows.length, longRows.length);
  if (n === 0) return;

  let maxMag = 0;
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = latRows[i].v;
    const y = longRows[i].v;
    points.push({ x, y, t: latRows[i].t - startTs });
    maxMag = Math.max(maxMag, Math.sqrt(x * x + y * y));
  }
  currentGripPoints = points;

  const chart = ensureGripChart();
  const niceMax = Math.max(0.5, Math.ceil(maxMag * 2) / 2);
  chart.data.datasets[0].data = circlePoints(niceMax / 2);
  chart.data.datasets[1].data = circlePoints(niceMax);
  chart.data.datasets[2].data = [{ x: points[0].x, y: points[0].y }]; // shows lap-start point until hover moves it

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
