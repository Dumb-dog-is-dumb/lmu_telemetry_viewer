// Shared Chart.js infrastructure for the 5 zoom-synced time-series panels (Speed/Throttle/
// Brake/Steering/Gear). The map/grip charts aren't part of the zoom sync group and manage
// their own options separately in their own panel modules.
Chart.register(ChartZoom);

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
    interaction: { intersect: false, mode: "index" },
    onHover: (event, _elements, chart) => {
      if (event.x == null || !chart.scales.x) return;
      const xVal = chart.scales.x.getValueForPixel(event.x);
      if (xVal == null || !isFinite(xVal)) return;
      onHoverX(xVal);
    },
  };
}
