import { lapState } from "./js/lapState.js";
import { charts, zoomSyncState } from "./js/chartsCommon.js";
import { renderAllChannels } from "./js/channelsPanel.js";
import { loadFiles, setStatus } from "./js/session.js";

const xAxisSelect = document.getElementById("xAxisSelect");

xAxisSelect.addEventListener("change", () => {
  lapState.xAxisMode = xAxisSelect.value;
  zoomSyncState.syncing = true;
  renderAllChannels();
  zoomSyncState.syncing = false;
});

document.getElementById("resetZoomBtn").addEventListener("click", () => {
  for (const key in charts) charts[key].resetZoom();
});

loadFiles().catch((err) => setStatus("Error: " + err.message));
