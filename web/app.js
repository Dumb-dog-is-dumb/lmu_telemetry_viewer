const sessionSelect = document.getElementById("sessionSelect");
const lapSelect = document.getElementById("lapSelect");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

let currentSession = null; // response from /api/session
let charts = {};
let syncingZoom = false;

Chart.register(ChartZoom);

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

const CHANNELS = [
  { key: "Ground Speed", canvas: "chartSpeed", color: "#4fa8ff" },
  { key: "Throttle Pos", canvas: "chartThrottle", color: "#4fd672" },
  { key: "Brake Pos", canvas: "chartBrake", color: "#ff5d5d" },
  { key: "Gear", canvas: "chartGear", color: "#f5c542", stepped: true },
];

function setStatus(text) {
  statusEl.textContent = text;
}

function formatLapTime(totalSeconds) {
  const totalMs = Math.round(totalSeconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
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
      highlightMapAtTime(tSec);
      highlightGripAtTime(tSec);
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
  ctx.canvas.addEventListener("mouseleave", () => {
    setMapCursor(null);
    setGripCursor(null);
  });
  charts[entry.key] = chart;
  return chart;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// The game's "GPS Latitude/Longitude" channels are real angular degrees (verified against
// the game's own Total Dist channel), just centered on an arbitrary fake reference point
// rather than the track's real-world location. Standard degree->meter conversion applies.
const METERS_PER_DEG_LAT = 111320;

let mapChart = null;
let currentMapPoints = []; // [{x, y, t}] sorted by t (t = seconds since lap start)

function setMapCursor(point) {
  if (!mapChart) return;
  mapChart.data.datasets[2].data = point ? [{ x: point.x, y: point.y }] : [];
  mapChart.update("none");
}

function highlightMapAtTime(tSec) {
  if (currentMapPoints.length === 0) return;
  let lo = 0;
  let hi = currentMapPoints.length - 1;
  if (tSec <= currentMapPoints[lo].t) return setMapCursor(currentMapPoints[lo]);
  if (tSec >= currentMapPoints[hi].t) return setMapCursor(currentMapPoints[hi]);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (currentMapPoints[mid].t < tSec) lo = mid;
    else hi = mid;
  }
  const nearest =
    tSec - currentMapPoints[lo].t < currentMapPoints[hi].t - tSec ? currentMapPoints[lo] : currentMapPoints[hi];
  setMapCursor(nearest);
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

async function loadMap(file, startTs, endTs) {
  const [lonRows, latRows] = await Promise.all([
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("GPS Longitude")}&start=${startTs}&end=${endTs}`),
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("GPS Latitude")}&start=${startTs}&end=${endTs}`),
  ]);

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
    points.push({
      x: (lonRows[i].v - lon0) * metersPerDegLon,
      y: (latRows[i].v - lat0) * METERS_PER_DEG_LAT,
      t: lonRows[i].t - startTs,
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

function highlightGripAtTime(tSec) {
  if (currentGripPoints.length === 0) return;
  let lo = 0;
  let hi = currentGripPoints.length - 1;
  if (tSec <= currentGripPoints[lo].t) return setGripCursor(currentGripPoints[lo]);
  if (tSec >= currentGripPoints[hi].t) return setGripCursor(currentGripPoints[hi]);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (currentGripPoints[mid].t < tSec) lo = mid;
    else hi = mid;
  }
  const nearest =
    tSec - currentGripPoints[lo].t < currentGripPoints[hi].t - tSec ? currentGripPoints[lo] : currentGripPoints[hi];
  setGripCursor(nearest);
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

async function loadGrip(file, startTs, endTs) {
  const [latRows, longRows] = await Promise.all([
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("G Force Lat")}&start=${startTs}&end=${endTs}`),
    fetchJSON(`/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent("G Force Long")}&start=${startTs}&end=${endTs}`),
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

async function loadFiles() {
  setStatus("Loading session list...");
  const files = await fetchJSON("/api/files");
  sessionSelect.innerHTML = "";
  if (files.length === 0) {
    sessionSelect.innerHTML = "<option>No telemetry files found</option>";
    setStatus("No .duckdb telemetry files found.");
    return;
  }
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f.file;
    const when = new Date(f.modified).toLocaleString();
    opt.textContent = `${f.track} — ${f.sessionType || "?"} — ${when} (${f.sizeMB} MB)`;
    sessionSelect.appendChild(opt);
  }
  setStatus("");
  await loadSession(sessionSelect.value);
}

async function loadSession(file) {
  if (!file) return;
  setStatus("Loading session info...");
  const info = await fetchJSON(`/api/session?file=${encodeURIComponent(file)}`);
  currentSession = info;

  const metaMap = {};
  for (const kv of info.metadata) metaMap[kv.key] = kv.value;
  metaEl.innerHTML = `
    <span><b>Track:</b> ${metaMap.TrackName ?? "-"}</span>
    <span><b>Car:</b> ${metaMap.CarName ?? "-"}</span>
    <span><b>Session:</b> ${metaMap.SessionType ?? "-"}</span>
    <span><b>Driver:</b> ${metaMap.DriverName ?? "-"}</span>
    <span><b>Weather:</b> ${metaMap.WeatherConditions ?? "-"}</span>
  `;

  lapSelect.innerHTML = "";
  const fullOpt = document.createElement("option");
  fullOpt.value = "full";
  fullOpt.textContent = "Full session";
  lapSelect.appendChild(fullOpt);

  for (const lap of info.laps) {
    const opt = document.createElement("option");
    opt.value = String(lap.lap);
    opt.textContent = `Lap ${lap.lap} (${formatLapTime(lap.duration)})`;
    lapSelect.appendChild(opt);
  }

  if (info.laps.length > 0) {
    lapSelect.value = String(info.laps[info.laps.length - 1].lap);
  }

  setStatus("");
  await loadLap(lapSelect.value, file);
}

async function loadLap(lapValue, file) {
  if (!currentSession) return;
  file = file || sessionSelect.value;

  let startTs, endTs;
  if (lapValue === "full" || !lapValue) {
    startTs = currentSession.t0;
    endTs = currentSession.sessionEnd;
  } else {
    const lap = currentSession.laps.find((l) => String(l.lap) === String(lapValue));
    if (!lap) return;
    startTs = lap.startTs;
    endTs = lap.endTs;
  }

  setStatus("Loading telemetry...");
  await Promise.all([
    ...CHANNELS.map(async (entry) => {
      const chart = ensureChart(entry);
      const rows = await fetchJSON(
        `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent(entry.key)}&start=${startTs}&end=${endTs}`
      );
      const points = rows.map((r) => ({ x: r.t - startTs, y: r.v }));
      chart.data.datasets[0].data = points;
      chart.options.scales.x.min = 0;
      chart.options.scales.x.max = endTs - startTs;
      chart.update();
      chart.resetZoom("none"); // clears any zoom left over from the previous lap
    }),
    loadMap(file, startTs, endTs),
    loadGrip(file, startTs, endTs),
  ]);
  setStatus("");
}

sessionSelect.addEventListener("change", () => loadSession(sessionSelect.value));
lapSelect.addEventListener("change", () => loadLap(lapSelect.value));
document.getElementById("resetZoomBtn").addEventListener("click", () => {
  for (const key in charts) charts[key].resetZoom();
});

loadFiles().catch((err) => setStatus("Error: " + err.message));
