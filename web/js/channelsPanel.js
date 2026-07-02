import { fetchJSON } from "./utils.js";
import { lapState, xValueFor, windowMax } from "./lapState.js";
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

const SLOTS = ["A", "B"];

let lastChannelRows = { A: {}, B: {} }; // slot -> channel key -> [{t, v}] with t relative to window start

function onHoverX(xVal) {
  // Slot B stays cached across a Compare toggle-off; skip it here too so its cursor doesn't
  // reappear on hover while its chart datasets are hidden.
  const slots = lapState.compareMode ? SLOTS : ["A"];
  for (const slot of slots) {
    highlightMapAtX(slot, xVal);
    highlightGripAtX(slot, xVal);
    highlightSuspAtX(slot, xVal);
  }
}

function datasetFor(entry, slot) {
  const dashed = slot === "B";
  return {
    label: `${entry.key} ${slot}`,
    data: [],
    borderColor: entry.color,
    backgroundColor: entry.color,
    borderWidth: 1.5,
    borderDash: dashed ? [6, 4] : undefined,
    stepped: entry.stepped ? "before" : false,
    tension: entry.stepped ? 0 : 0.05,
  };
}

function ensureChart(entry) {
  if (charts[entry.key]) return charts[entry.key];
  const ctx = document.getElementById(entry.canvas).getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      // Index 0 = slot A (today's single dataset, unchanged look), index 1 = slot B (dashed,
      // empty/inert whenever Compare is off or B hasn't loaded yet).
      datasets: [datasetFor(entry, "A"), datasetFor(entry, "B")],
    },
    options: baseChartOptions(entry.key, onHoverX),
  });
  ctx.canvas.addEventListener("mouseleave", () => {
    for (const slot of SLOTS) {
      setMapCursor(slot, null);
      setGripCursor(slot, null);
      setSuspCursor(slot, null);
    }
  });
  charts[entry.key] = chart;
  return chart;
}

export function renderChannel(entry) {
  const chart = charts[entry.key];
  if (!chart) return;
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i];
    // Slot B stays cached in lastChannelRows across a Compare toggle-off (so re-enabling
    // Compare doesn't need a re-fetch), but must not render while Compare is off.
    const rows = (slot === "A" || lapState.compareMode) && lastChannelRows[slot][entry.key];
    chart.data.datasets[i].data = rows ? rows.map((r) => ({ x: xValueFor(slot, r.t), y: r.v })) : [];
  }
  chart.options.scales.x.min = 0;
  chart.options.scales.x.max = windowMax();
  chart.options.scales.x.title.text =
    lapState.xAxisMode === "distance" ? "Distance (m, from lap start)" : "Time (s, from lap start)";
  chart.update();
  chart.resetZoom("none"); // clears any zoom left over from the previous render
}

export function renderAllChannels() {
  for (const entry of CHANNELS) renderChannel(entry);
}

export async function loadChannel(entry, slot, file, startTs, endTs, generation) {
  ensureChart(entry);
  const rows = await fetchJSON(
    `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent(entry.key)}&start=${startTs}&end=${endTs}`
  );
  if (generation !== lapState.generation[slot]) return; // superseded by a newer loadLap() call
  lastChannelRows[slot][entry.key] = rows.map((r) => ({ t: r.t - startTs, v: r.v }));
  renderChannel(entry);
}
