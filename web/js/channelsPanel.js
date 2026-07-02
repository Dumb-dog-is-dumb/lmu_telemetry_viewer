import { fetchJSON } from "./utils.js";
import { lapState, xValueFor } from "./lapState.js";
import { charts, baseChartOptions } from "./chartsCommon.js";
import { setMapCursor, highlightMapAtX } from "./mapPanel.js";
import { setGripCursor, highlightGripAtX } from "./gripPanel.js";
import { setSuspCursor, highlightSuspAtX } from "./suspPanel.js";

export const CHANNELS = [
  { key: "Ground Speed", canvas: "chartSpeed", color: "#4fa8ff" },
  { key: "Throttle Pos", canvas: "chartThrottle", color: "#4fd672" },
  { key: "Brake Pos", canvas: "chartBrake", color: "#ff5d5d" },
  { key: "Steering Pos", canvas: "chartSteering", color: "#b366ff" },
  { key: "Gear", canvas: "chartGear", color: "#f5c542", stepped: true },
];

let lastChannelRows = {}; // key: channel key -> [{t, v}] with t relative to window start

function onHoverX(xVal) {
  highlightMapAtX(xVal);
  highlightGripAtX(xVal);
  highlightSuspAtX(xVal);
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
    options: baseChartOptions(entry.key, onHoverX),
  });
  ctx.canvas.addEventListener("mouseleave", () => {
    setMapCursor(null);
    setGripCursor(null);
    setSuspCursor(null);
  });
  charts[entry.key] = chart;
  return chart;
}

export function renderChannel(entry) {
  const chart = charts[entry.key];
  const rows = lastChannelRows[entry.key];
  if (!chart || !rows) return;
  chart.data.datasets[0].data = rows.map((r) => ({ x: xValueFor(r.t), y: r.v }));
  chart.options.scales.x.min = 0;
  chart.options.scales.x.max = lapState.xAxisMode === "distance" ? lapState.windowDistance : lapState.windowDuration;
  chart.options.scales.x.title.text =
    lapState.xAxisMode === "distance" ? "Distance (m, from lap start)" : "Time (s, from lap start)";
  chart.update();
  chart.resetZoom("none"); // clears any zoom left over from the previous render
}

export function renderAllChannels() {
  for (const entry of CHANNELS) renderChannel(entry);
}

export async function loadChannel(entry, file, startTs, endTs, generation) {
  ensureChart(entry);
  const rows = await fetchJSON(
    `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent(entry.key)}&start=${startTs}&end=${endTs}`
  );
  if (generation !== lapState.loadGeneration) return; // superseded by a newer loadLap() call
  lastChannelRows[entry.key] = rows.map((r) => ({ t: r.t - startTs, v: r.v }));
  renderChannel(entry);
}
