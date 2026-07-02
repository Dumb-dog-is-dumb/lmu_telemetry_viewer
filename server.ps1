param(
    [int]$Port = 8787,
    [string]$TelemetryDir = "C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\UserData\Telemetry",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$duckdb = Join-Path $root "tools\duckdb.exe"
$webDir = Join-Path $root "web"

if (-not (Test-Path $duckdb)) { throw "duckdb.exe not found at $duckdb" }
if (-not (Test-Path $TelemetryDir)) { throw "Telemetry folder not found: $TelemetryDir" }

# Channels we expose to the UI. Each is either "regular" (fixed-frequency, row-indexed,
# needs a computed time axis) or "irregular" (has its own ts column, e.g. discrete events).
$RegularChannels = @("Ground Speed", "Throttle Pos", "Brake Pos", "Steering Pos", "GPS Latitude", "GPS Longitude", "G Force Lat", "G Force Long", "Lap Dist")
$IrregularChannels = @("Gear")
# Regular channels with one column per wheel instead of a single "value" column. Order
# verified by correlating against Steering Pos/G Force Lat (same rowid/100Hz for the
# steering check): value1/value3 move together and opposite to value2/value4, matching the
# standard FL/FR/RL/RR wheel-array convention this engine (rFactor2-derived) uses elsewhere.
$MultiValueChannels = @{
    "Susp Pos" = @(
        @{ col = "value1"; key = "fl" },
        @{ col = "value2"; key = "fr" },
        @{ col = "value3"; key = "rl" },
        @{ col = "value4"; key = "rr" }
    )
}
$AllowedChannels = $RegularChannels + $IrregularChannels + @($MultiValueChannels.Keys)

# Small in-memory cache so repeated requests against the same file don't re-run
# metadata/frequency lookups every time.
$SessionCache = @{}

# Cache for the /api/files summary (car name + fastest complete lap) keyed by path only.
# Note: opening these files with duckdb.exe touches LastWriteTime (looks like a WAL
# checkpoint on open), so mtime can't be used as a cache-invalidation key here - it would
# never hit. Matches $SessionCache, which has the same path-only-key assumption.
$FileSummaryCache = @{}

function Get-FileSummary {
    param([string]$DbPath)
    if ($FileSummaryCache.ContainsKey($DbPath)) { return $FileSummaryCache[$DbPath] }

    $car = $null
    $fastestLap = $null
    try {
        # "Lap Time" records a completed lap's duration at the ts where the *next* lap
        # starts; the out-lap (lap 0) is always 0.0 and the final in-progress lap never
        # gets an entry, so filtering value > 0 already isolates complete laps.
        $sql = "SELECT (SELECT value FROM metadata WHERE key='CarName') AS car, " +
               "(SELECT min(value) FROM `"Lap Time`" WHERE value > 0) AS fastestLap;"
        $json = Invoke-DuckDb $DbPath $sql
        $rows = $json | ConvertFrom-Json
        if ($rows.Count -gt 0) {
            $car = $rows[0].car
            if ($null -ne $rows[0].fastestLap) { $fastestLap = [double]$rows[0].fastestLap }
        }
    } catch { }

    $summary = [PSCustomObject]@{ car = $car; fastestLap = $fastestLap }
    $FileSummaryCache[$DbPath] = $summary
    return $summary
}

function Invoke-DuckDb {
    param([string]$DbPath, [string]$Sql)
    # SQL is piped via stdin rather than passed as a -c argument: PowerShell mangles
    # embedded double quotes when building native-exe command lines, which corrupts
    # quoted identifiers like "GPS Time".
    $out = $Sql | & $duckdb $DbPath -json 2>&1
    $text = ($out -join "`n").Trim()
    if ($LASTEXITCODE -ne 0) { throw "duckdb error: $text" }
    if ([string]::IsNullOrWhiteSpace($text)) { return "[]" }
    return $text
}

function Get-SafeDbPath {
    param([string]$FileName)
    if ([string]::IsNullOrWhiteSpace($FileName)) { throw "missing file parameter" }
    if ($FileName -match '[\\/]' -or $FileName -notmatch '\.duckdb$') { throw "invalid file name" }
    $full = Join-Path $TelemetryDir $FileName
    $resolved = [System.IO.Path]::GetFullPath($full)
    $resolvedDir = [System.IO.Path]::GetFullPath($TelemetryDir)
    if (-not $resolved.StartsWith($resolvedDir, [StringComparison]::OrdinalIgnoreCase)) { throw "path escape rejected" }
    if (-not (Test-Path $resolved)) { throw "file not found" }
    return $resolved
}

function Get-SessionInfo {
    param([string]$DbPath)
    if ($SessionCache.ContainsKey($DbPath)) { return $SessionCache[$DbPath] }

    # CarSetup is a JSON blob of tuning params (excluded from the plain key/value rows
    # below); VM_FRONT/REAR_TIRE_COMPOUND.stringValue inside it is the only place the
    # human-readable compound name ("Medium", "Soft", ...) lives - the "TyresCompound"
    # channel table just logs a numeric index, not a name.
    $metaSql = @'
SELECT key, value FROM metadata WHERE key != 'CarSetup'
UNION ALL
SELECT 'TireCompoundFront' AS key, json_extract_string(value, '$.VM_FRONT_TIRE_COMPOUND.stringValue') AS value FROM metadata WHERE key = 'CarSetup'
UNION ALL
SELECT 'TireCompoundRear' AS key, json_extract_string(value, '$.VM_REAR_TIRE_COMPOUND.stringValue') AS value FROM metadata WHERE key = 'CarSetup'
'@
    $metaJson = Invoke-DuckDb $DbPath $metaSql
    $meta = $metaJson | ConvertFrom-Json

    $chanJson = Invoke-DuckDb $DbPath "SELECT channelName, frequency, unit FROM channelsList;"
    $chanRows = $chanJson | ConvertFrom-Json
    $freqMap = @{}
    foreach ($r in $chanRows) { $freqMap[$r.channelName] = $r }

    $t0 = 0.0
    try {
        $t0Json = Invoke-DuckDb $DbPath "SELECT value FROM `"GPS Time`" LIMIT 1;"
        $t0Rows = $t0Json | ConvertFrom-Json
        if ($t0Rows.Count -gt 0) { $t0 = [double]$t0Rows[0].value }
    } catch { $t0 = 0.0 }

    $lapJson = Invoke-DuckDb $DbPath "SELECT ts, value FROM `"Lap`" ORDER BY ts;"
    $lapRows = $lapJson | ConvertFrom-Json

    $sessionEndJson = Invoke-DuckDb $DbPath "SELECT max(value) as m FROM `"GPS Time`";"
    $sessionEndRows = $sessionEndJson | ConvertFrom-Json
    $sessionEnd = if ($sessionEndRows.Count -gt 0) { [double]$sessionEndRows[0].m } else { $t0 }

    $laps = @()
    for ($i = 0; $i -lt $lapRows.Count; $i++) {
        $startTs = [double]$lapRows[$i].ts
        $endTs = if ($i -lt $lapRows.Count - 1) { [double]$lapRows[$i + 1].ts } else { $sessionEnd }
        $laps += [PSCustomObject]@{
            lap     = $lapRows[$i].value
            startTs = $startTs
            endTs   = $endTs
            duration = [math]::Round($endTs - $startTs, 3)
        }
    }

    $info = [PSCustomObject]@{
        metadataJson = $metaJson
        t0       = $t0
        sessionEnd = $sessionEnd
        laps     = $laps
        frequencies = $freqMap
    }
    $SessionCache[$DbPath] = $info
    return $info
}

function Write-JsonResponse {
    param($Context, [string]$Json, [int]$Status = 200)
    # A client that disconnects mid-response (browser cancels a request, HEAD request,
    # etc.) can make OutputStream.Write/Close throw. That must never escape and kill the
    # single-threaded listener loop, so every step here is best-effort.
    try {
        $Context.Response.StatusCode = $Status
        $Context.Response.ContentType = "application/json; charset=utf-8"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { }
    try { $Context.Response.OutputStream.Close() } catch { }
}

function Write-FileResponse {
    param($Context, [string]$Path)
    try {
        $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
        $ct = switch ($ext) {
            ".html" { "text/html; charset=utf-8" }
            ".js"   { "application/javascript; charset=utf-8" }
            ".css"  { "text/css; charset=utf-8" }
            default { "application/octet-stream" }
        }
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $Context.Response.StatusCode = 200
        $Context.Response.ContentType = $ct
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { }
    try { $Context.Response.OutputStream.Close() } catch { }
}

function Get-QueryParams {
    param([System.Uri]$Url)
    $params = @{}
    $q = $Url.Query.TrimStart('?')
    foreach ($pair in $q -split '&') {
        if ([string]::IsNullOrEmpty($pair)) { continue }
        $kv = $pair -split '=', 2
        $key = [System.Uri]::UnescapeDataString($kv[0])
        $val = if ($kv.Count -gt 1) { [System.Uri]::UnescapeDataString($kv[1]) } else { "" }
        $params[$key] = $val
    }
    return $params
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "LMU Telemetry Viewer running at $prefix"
Write-Host "Reading replays telemetry from: $TelemetryDir"
Write-Host "Press Ctrl+C to stop."

if (-not $NoBrowser) {
    Start-Process $prefix | Out-Null
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $req = $context.Request
            $path = $req.Url.AbsolutePath

            if ($path -eq "/" -or $path -eq "/index.html") {
                Write-FileResponse $context (Join-Path $webDir "index.html")
            }
            elseif ($path -eq "/app.js") {
                Write-FileResponse $context (Join-Path $webDir "app.js")
            }
            elseif ($path -eq "/chart.umd.min.js") {
                Write-FileResponse $context (Join-Path $webDir "chart.umd.min.js")
            }
            elseif ($path -eq "/chartjs-plugin-zoom.min.js") {
                Write-FileResponse $context (Join-Path $webDir "chartjs-plugin-zoom.min.js")
            }
            elseif ($path -eq "/style.css") {
                Write-FileResponse $context (Join-Path $webDir "style.css")
            }
            elseif ($path -eq "/api/files") {
                $files = Get-ChildItem -Path $TelemetryDir -Filter "*.duckdb" -File
                $list = @()
                foreach ($f in $files) {
                    # Expected pattern: "<Track>_<SessionType>_<ISO timestamp>.duckdb". The
                    # timestamp in the name is the actual session start time and is used for
                    # display/sort instead of the file's LastWriteTime: opening these files
                    # with duckdb.exe touches mtime (looks like a WAL checkpoint on open),
                    # which was silently reordering the list on every /api/files call.
                    $name = $f.BaseName
                    $track = $name
                    $sessionType = ""
                    $sessionTime = $f.LastWriteTime
                    $m = [regex]::Match($name, '^(?<track>.+)_(?<type>[A-Za-z]+)_(?<ts>\d{4})-(?<mo>\d{2})-(?<da>\d{2})T(?<h>\d{2})_(?<mi>\d{2})_(?<s>\d{2})Z$')
                    if ($m.Success) {
                        $track = $m.Groups['track'].Value
                        $sessionType = $m.Groups['type'].Value
                        $sessionTime = [datetime]::new(
                            [int]$m.Groups['ts'].Value, [int]$m.Groups['mo'].Value, [int]$m.Groups['da'].Value,
                            [int]$m.Groups['h'].Value, [int]$m.Groups['mi'].Value, [int]$m.Groups['s'].Value,
                            [System.DateTimeKind]::Utc)
                    }
                    $summary = Get-FileSummary $f.FullName
                    $list += [PSCustomObject]@{
                        file        = $f.Name
                        track       = $track
                        sessionType = $sessionType
                        sessionTime = $sessionTime.ToString("o")
                        sizeMB      = [math]::Round($f.Length / 1MB, 1)
                        car         = $summary.car
                        fastestLap  = $summary.fastestLap
                    }
                }
                # @(...) guards against PowerShell unwrapping a single-element pipeline
                # result to a bare object instead of a one-item array.
                $list = @($list | Sort-Object sessionTime -Descending)
                Write-JsonResponse $context ($list | ConvertTo-Json -Depth 5)
            }
            elseif ($path -eq "/api/session") {
                $qp = Get-QueryParams $req.Url
                $dbPath = Get-SafeDbPath $qp["file"]
                $info = Get-SessionInfo $dbPath
                # Built by hand rather than ConvertTo-Json: nesting a PowerShell array as an
                # object property confuses Windows PowerShell's serializer, which wraps it as
                # {"value": [...], "Count": n} instead of a plain JSON array.
                $ic = [System.Globalization.CultureInfo]::InvariantCulture
                $lapParts = foreach ($lap in $info.laps) {
                    "{{`"lap`":{0},`"startTs`":{1},`"endTs`":{2},`"duration`":{3}}}" -f `
                        $lap.lap, $lap.startTs.ToString($ic), $lap.endTs.ToString($ic), $lap.duration.ToString($ic)
                }
                $lapsJson = "[" + ($lapParts -join ",") + "]"
                $body = "{{`"metadata`":{0},`"t0`":{1},`"sessionEnd`":{2},`"laps`":{3}}}" -f `
                    $info.metadataJson, $info.t0.ToString($ic), $info.sessionEnd.ToString($ic), $lapsJson
                Write-JsonResponse $context $body
            }
            elseif ($path -eq "/api/channel") {
                $qp = Get-QueryParams $req.Url
                $dbPath = Get-SafeDbPath $qp["file"]
                $channel = $qp["channel"]
                if ($AllowedChannels -notcontains $channel) { throw "channel not allowed: $channel" }
                $startTs = [double]$qp["start"]
                $endTs = [double]$qp["end"]
                $info = Get-SessionInfo $dbPath

                if ($IrregularChannels -contains $channel) {
                    $sql = "SELECT t, v FROM (" +
                           "SELECT ts AS t, value AS v FROM `"$channel`" WHERE ts BETWEEN $startTs AND $endTs " +
                           "UNION ALL " +
                           "(SELECT ts AS t, value AS v FROM `"$channel`" WHERE ts < $startTs ORDER BY ts DESC LIMIT 1)" +
                           ") ORDER BY t;"
                }
                elseif ($MultiValueChannels.ContainsKey($channel)) {
                    $freq = [double]$info.frequencies[$channel].frequency
                    $t0 = [double]$info.t0
                    $rowStart = [math]::Floor(($startTs - $t0) * $freq)
                    $rowEnd = [math]::Ceiling(($endTs - $t0) * $freq)
                    if ($rowStart -lt 0) { $rowStart = 0 }
                    $cols = ($MultiValueChannels[$channel] | ForEach-Object { "$($_.col) AS $($_.key)" }) -join ", "
                    $sql = "SELECT (rowid / $freq + $t0) AS t, $cols FROM `"$channel`" " +
                           "WHERE rowid BETWEEN $rowStart AND $rowEnd ORDER BY rowid;"
                }
                else {
                    $freq = [double]$info.frequencies[$channel].frequency
                    $t0 = [double]$info.t0
                    $rowStart = [math]::Floor(($startTs - $t0) * $freq)
                    $rowEnd = [math]::Ceiling(($endTs - $t0) * $freq)
                    if ($rowStart -lt 0) { $rowStart = 0 }
                    $sql = "SELECT (rowid / $freq + $t0) AS t, value AS v FROM `"$channel`" " +
                           "WHERE rowid BETWEEN $rowStart AND $rowEnd ORDER BY rowid;"
                }
                $json = Invoke-DuckDb $dbPath $sql
                Write-JsonResponse $context $json
            }
            else {
                Write-JsonResponse $context (ConvertTo-Json @{ error = "not found" }) 404
            }
        }
        catch {
            Write-JsonResponse $context (ConvertTo-Json @{ error = $_.Exception.Message }) 500
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
