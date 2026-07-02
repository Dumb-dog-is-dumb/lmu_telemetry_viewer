import { formatLapTime } from "./utils.js";
import { getFiles, selectSession } from "./session.js";

const modal = document.getElementById("sessionTableModal");
const closeBtn = document.getElementById("sessionTableCloseBtn");
const tableEl = document.getElementById("sessionTable");

let dataTable = null;
let target = "A"; // which slot's session select a row click should drive

closeBtn.addEventListener("click", () => modal.close());
// A click on the <dialog> element itself (not a descendant) means the backdrop/padding was
// clicked, not the table content - the standard no-extra-markup way to detect a backdrop
// click on a native <dialog>.
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
});

// Zero-padded so lexicographic (string) sort matches chronological/time order - lets the
// table stay sortable without needing the library's date/number type parsing.
function formatDateSortable(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLapTimeSortable(seconds) {
  if (seconds == null) return "-";
  const [m, rest] = formatLapTime(seconds).split(":");
  return `${m.padStart(2, "0")}:${rest}`;
}

// Single source of truth for a row's displayed cell text, used both to build the table and
// to identify which file a clicked row corresponds to (see click handler below).
function rowText(f) {
  return [
    f.track,
    f.sessionType || "?",
    formatDateSortable(f.sessionTime),
    f.car || "-",
    formatLapTimeSortable(f.fastestLap),
    String(f.sizeMB),
  ];
}

function buildTable() {
  const files = getFiles() || [];
  dataTable = new simpleDatatables.DataTable(tableEl, {
    data: { headings: ["Track", "Type", "Date/Time", "Car", "Best Lap", "Size (MB)"], data: files.map(rowText) },
    perPage: 20,
    columns: [{ select: 5, type: "number" }],
  });
  // Rather than trust the library's own row index (its "datatable.selectrow" event reports
  // an index into an internal array that gets reordered in place on sort, so it stops
  // matching `files` once the user sorts a column - confirmed by testing), match the
  // clicked <tr>'s own rendered cell text back to a file via the same rowText() used to
  // build the table. This only depends on what's actually on screen, so it's correct
  // regardless of sorting/searching/pagination.
  tableEl.addEventListener("click", (e) => {
    const tr = e.target.closest("tbody tr");
    if (!tr) return;
    const cells = Array.from(tr.children).map((td) => td.textContent.trim());
    const file = files.find((f) => rowText(f).every((v, i) => String(v) === cells[i]));
    if (!file) return;
    selectSession(target, file.file);
    modal.close();
  });
}

export function openSessionTable(slot) {
  target = slot;
  if (!dataTable) buildTable();
  modal.showModal();
}
