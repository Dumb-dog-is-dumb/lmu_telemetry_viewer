# CLAUDE.md

## Overview

Local telemetry viewer for Le Mans Ultimate (racing sim). LMU (since v1.2) writes
per-session telemetry to DuckDB files at:
`C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\UserData\Telemetry\*.duckdb`

This is separate from the game's `.Vcr` replay files (`UserData\Replays\`), which are an
undocumented proprietary binary format deliberately NOT parsed — the DuckDB export covers
everything needed and was the much better path.

App shows Speed/Throttle/Brake/Gear time-series per lap, a track map (from GPS-shaped
position channels), and a G-G "grip circle", all mouse-synced via hover.

## Architecture — and why it looks like this

This Windows machine has **no Node.js and no working Python** (Python is just the MS Store
stub alias). That constraint drove every stack choice below. If Node/Python later becomes
available, there's no strong reason to rewrite something that already works.

- **Backend** (`server.ps1`): hand-rolled HTTP server using `System.Net.HttpListener`
  (built into Windows PowerShell, zero install). Serves static files from `web/` plus a
  small JSON API (`/api/files`, `/api/session`, `/api/channel`).
- **Data access**: shells out to `tools/duckdb.exe` (official portable CLI binary, vendored,
  not installed system-wide) per query. No ORM/driver — server.ps1 builds SQL strings and
  parses `duckdb.exe -json` stdout.
- **Frontend**: no build step, no npm. Chart.js (`web/chart.umd.min.js`) and
  chartjs-plugin-zoom (`web/chartjs-plugin-zoom.min.js`) are vendored UMD files (one-time
  download from jsdelivr) so the app works fully offline.

## Data model (DuckDB files) — figured out by inspection, not documented anywhere

- Each channel is its own **table** (e.g. `"Ground Speed"`, `"Gear"`), not one wide table.
  `SHOW TABLES` lists ~101 channel tables plus `metadata`, `channelsList`, `eventsList`.
- Two kinds of channel tables:
  - **Regular/fixed-frequency** (`Ground Speed`, `Throttle Pos`, `Brake Pos`,
    `GPS Latitude/Longitude`, `G Force Lat/Long`, ...): only a `value` column, sampled at a
    fixed Hz from `channelsList` (`channelName, frequency, unit`). Time is *computed*:
    `time[i] = t0 + rowid/frequency`. DuckDB's `rowid` pseudo-column makes this work.
  - **Irregular/event** (`Gear`, `Lap`, `Lap Time`, ...): explicit `ts, value` columns,
    written only when the value changes.
- `t0` (recording's absolute start, seconds) = value of the *first row* of `"GPS Time"`
  (itself a 100Hz regular channel whose value already equals `t0 + rowid/100`). This anchors
  rowid→timestamp conversion for every regular channel. See `Get-SessionInfo` in server.ps1.
- Lap boundaries: `"Lap"` table (`ts`, `value`=lap number). Lap window = `[thisLap.ts,
  nextLap.ts)`; last lap's end = `max("GPS Time")`.
- Allow-list of exposed channels: `$RegularChannels` / `$IrregularChannels` near the top of
  `server.ps1`. **Extend those arrays (and confirm the channel exists in
  `channelsList`/`SHOW TABLES`) before wiring up any new graph** — `/api/channel` rejects
  anything not on the list.
- `GPS Latitude`/`GPS Longitude` are real angular degrees (verified: converted to meters via
  `111320` m/° lat and `111320*cos(mean_lat)` m/° lon, compared path length to the game's own
  `"Total Dist"` delta over the same window — matched within ~0.5%). But they're centered on
  an **arbitrary fake reference point** (lat ≈ 60°), not the track's real-world location —
  don't try to plot on a real map or geocode them.
- `G Force Long` sign convention: **negative = braking, positive = accelerating** (verified
  by correlating with `Brake Pos`/`Throttle Pos` — those run at different Hz than
  `G Force Long`, so any such check must convert rowid→time per-channel first, not join raw
  rowids).
- **No per-wheel tyre load/vertical force channel exists.** `Susp Pos` (suspension travel) is
  there but converting to load needs spring-rate data we don't have. If asked for tyre load
  again: still not directly available, `Susp Pos` is the closest indirect proxy.
- Known/accepted limitation: the first lap of a recording (before crossing start/finish)
  looks visually odd on the map/graphs since position data starts mid-corner. User has seen
  this, it's fine — not a bug to reflexively "fix".

## PowerShell gotchas (already hit — don't repeat)

1. **Never pass SQL to duckdb.exe as a `-c` argument.** `& $duckdb $db -json -c $sql`
   silently corrupts embedded double quotes, breaking any query with a quoted identifier
   like `"GPS Time"`. Fix in use: pipe via stdin — `$sql | & $duckdb $db -json` — this is
   `Invoke-DuckDb` in server.ps1. Always route queries through that helper.
2. **Backslash does not escape in PowerShell double-quoted strings.**
   `"SELECT * FROM \"Foo\""` does NOT yield a literal quote — it silently breaks. Use a
   backtick: `` "SELECT * FROM `"Foo`"" ``.
3. **`ConvertTo-Json` mis-serializes an array nested as a property of a `[PSCustomObject]`
   hashtable literal** (e.g. an array from `ConvertFrom-Json` assigned to `.items` then
   re-serialized) — can produce `{"items": {"value": [...], "Count": n}}` instead of a plain
   array. Bit us in `/api/session`, which now hand-builds that JSON via string interpolation
   instead of trusting `ConvertTo-Json` for the nested `laps` array. `/api/files` is fine
   because it's a *top-level* array with no nesting — same bug doesn't apply there.
4. **`UNION ALL` + `ORDER BY ... LIMIT` applies to the whole union, not just the last
   SELECT.** Wrap the branch needing its own limit in parens:
   `SELECT ... UNION ALL (SELECT ... ORDER BY ts DESC LIMIT 1)`. Got bitten in the Gear
   channel query (silently returned 1 row instead of ~86) — see the irregular-channel SQL in
   the `/api/channel` handler.
5. **CSS specificity trap** (`web/style.css`): `.chart-box canvas { height: 140px !important
   }` and `.map-box canvas { height: 900px !important }` have identical specificity, so
   source order silently decided the winner (wrong one), forcing map/grip to the small-chart
   height. Fixed via a non-colliding `.chart-fill` wrapper class placed *after* the generic
   rule. Lesson: don't rely on `!important` + equal-specificity selectors on the same
   element — use non-overlapping selectors.
6. **Background process lifecycle**: launching the server with `Start-Process ...
   -WindowStyle Hidden` from inside a *foreground* tool call gets killed when that call's
   process tree is cleaned up (dies a few seconds later, no visible reason). Fix: run
   `server.ps1` directly (not via `Start-Process`) inside a tool call using
   `run_in_background: true`.

## Running it

- Double-click `start.bat`, or: `powershell -ExecutionPolicy Bypass -File server.ps1`
  - Opens browser to `http://localhost:8787` automatically; pass `-NoBrowser` to suppress
    (e.g. so a coding agent can curl-test the API without popping a window).
- No build step for frontend — edit `web/*.html|css|js`, refresh the page, done.
- **Server restart required** after editing `server.ps1` (e.g. adding a channel to the
  allow-list).

## Future ideas (not commitments — data exists, UI doesn't)

- Tyre channels exist (`TyresPressure`, `TyresCarcassTemp`, `TyresRimTemp`,
  `TyresRubberTemp`, `TyresTempCentre/Left/Right`, `Tyres Wear`) but their per-wheel schema
  hasn't been inspected — `DESCRIBE` them before building any UI.
- Brake temps (`Brakes Temp`, `Brakes Air Temp`) and `Brake Bias Rear` are available, unused.
- Lap-over-lap comparison/overlay — API already returns per-lap start/end ts, mostly
  frontend work.
- Sector times (`Current/Last/Best Sector1/2` tables exist) — not surfaced in UI yet.
- Distance-based x-axis alternative to time (`"Lap Dist"` channel, 10Hz) — useful for
  comparing corners across laps of different pace.
