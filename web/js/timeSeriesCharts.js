import { getChannel } from "./api.js";
import { moveCursor, clearCursor } from "./cursorSync.js";

const CHANNELS = [
  { key: "Ground Speed", canvas: "chartSpeed", color: "#4fa8ff" },
  { key: "Throttle Pos", canvas: "chartThrottle", color: "#4fd672" },
  { key: "Brake Pos", canvas: "chartBrake", color: "#ff5d5d" },
  { key: "Steering Pos", canvas: "chartSteering", color: "#b366ff" },
  { key: "Gear", canvas: "chartGear", color: "#f5c542", stepped: true },
];

const charts = {};
let syncingZoom = false;

function syncZoomAcrossCharts(sourceChart) {
  if (syncingZoom) return;
  syncingZoom = true;
  const { min, max } = sourceChart.scales.x;
  for (const key in charts) {
    const other = charts[key];
    if (other === sourceChart) continue;
    other.zoomScale("x", { min, max }, "none");
  }
  syncingZoom = false;
}

function baseChartOptions(yTitle) {
  return {
    animation: false,
    parsing: false,
    normalized: true,
    maintainAspectRatio: false,
    elements: { point: { radius: 0 } },
    scales: {
      x: {
        type: "linear",
        bounds: "data",
        title: { display: true, text: "Time (s, from lap start)" },
        grid: { color: "#2c313a" },
        ticks: { color: "#9aa2ad" },
      },
      y: {
        title: { display: true, text: yTitle },
        grid: { color: "#2c313a" },
        ticks: { color: "#9aa2ad" },
      },
    },
    plugins: {
      legend: { display: false },
      zoom: {
        limits: { x: { min: "original", max: "original" } },
        pan: {
          enabled: true,
          mode: "x",
          modifierKey: "shift",
          onPanComplete: ({ chart }) => syncZoomAcrossCharts(chart),
        },
        zoom: {
          wheel: { enabled: true },
          drag: { enabled: true },
          mode: "x",
          onZoomComplete: ({ chart }) => syncZoomAcrossCharts(chart),
        },
      },
    },
    interaction: { intersect: false, mode: "index" },
    onHover: (event, _elements, chart) => {
      if (event.x == null || !chart.scales.x) return;
      const tSec = chart.scales.x.getValueForPixel(event.x);
      if (tSec == null || !isFinite(tSec)) return;
      moveCursor(tSec);
    },
  };
}

function ensureChart(entry) {
  if (charts[entry.key]) return charts[entry.key];
  const ctx = document.getElementById(entry.canvas).getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: entry.key,
          data: [],
          borderColor: entry.color,
          backgroundColor: entry.color,
          borderWidth: 1.5,
          stepped: entry.stepped ? "before" : false,
          tension: entry.stepped ? 0 : 0.05,
        },
      ],
    },
    options: baseChartOptions(entry.key),
  });
  ctx.canvas.addEventListener("mouseleave", () => clearCursor());
  charts[entry.key] = chart;
  return chart;
}

export async function loadTimeSeriesCharts(file, startTs, endTs) {
  await Promise.all(
    CHANNELS.map(async (entry) => {
      const chart = ensureChart(entry);
      const rows = await getChannel(file, entry.key, startTs, endTs);
      const points = rows.map((r) => ({ x: r.t - startTs, y: r.v }));
      chart.data.datasets[0].data = points;
      chart.options.scales.x.min = 0;
      chart.options.scales.x.max = endTs - startTs;
      chart.update();
      chart.resetZoom("none"); // clears any zoom left over from the previous lap
    })
  );
}

export function resetAllZoom() {
  for (const key in charts) charts[key].resetZoom();
}
