import { nearestIndexByKey } from "./utils.js";

// Shared Chart.js infrastructure for the 5 zoom-synced time-series panels (Speed/Throttle/
// Brake/Steering/Gear). The map/grip charts aren't part of the zoom sync group and manage
// their own options separately in their own panel modules.
Chart.register(ChartZoom);

// Custom interaction mode: nearest point *per dataset* by actual x-value. Built-in "index"
// matches datasets by array position, which breaks once slot A and slot B are different
// lengths (different lap durations/sample counts) - dataset B's highlighted point lands at
// whatever array index corresponds to slot A's index, not the same x pixel. Built-in "x"
// fixes the alignment but returns every point within hit-range of the pixel, which can be
// more than one per dataset on these dense (100Hz+) series, producing duplicate tooltip rows.
// This mode picks exactly one nearest-by-x point per visible dataset.
Chart.Interaction.modes.nearestPerDataset = (chart, e, _options, _useFinalPosition) => {
  const position = Chart.helpers.getRelativePosition(e, chart);
  const xScale = chart.scales.x;
  if (!xScale) return [];
  const targetVal = xScale.getValueForPixel(position.x);
  const items = [];
  for (const meta of chart.getSortedVisibleDatasetMetas()) {
    const data = chart.data.datasets[meta.index].data;
    const idx = nearestIndexByKey(data, "x", targetVal);
    if (idx !== -1) items.push({ element: meta.data[idx], datasetIndex: meta.index, index: idx });
  }
  return items;
};

export const charts = {}; // key -> Chart instance, only the zoom-synced channel charts

// Guards against re-entrant zoom syncing, and is also used by session.js to suppress syncing
// during a bulk per-lap reset of all charts at once (see loadLap in session.js for why).
export const zoomSyncState = { syncing: false };

export function syncZoomAcrossCharts(sourceChart) {
  if (zoomSyncState.syncing) return;
  zoomSyncState.syncing = true;
  const { min, max } = sourceChart.scales.x;
  for (const key in charts) {
    const other = charts[key];
    if (other === sourceChart) continue;
    other.zoomScale("x", { min, max }, "none");
  }
  zoomSyncState.syncing = false;
}

// `onHoverX(xVal)` is called with the x-axis value under the cursor; callers wire it up to
// whatever cross-panel cursor highlighting they need (channelsPanel.js hooks up the map/grip/
// susp highlight functions).
export function baseChartOptions(yTitle, onHoverX) {
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
    // See the "nearestPerDataset" registration above for why this custom mode is needed
    // instead of the built-in "index" or "x".
    interaction: { intersect: false, mode: "nearestPerDataset" },
    onHover: (event, _elements, chart) => {
      if (event.x == null || !chart.scales.x) return;
      const xVal = chart.scales.x.getValueForPixel(event.x);
      if (xVal == null || !isFinite(xVal)) return;
      onHoverX(xVal);
    },
  };
}
