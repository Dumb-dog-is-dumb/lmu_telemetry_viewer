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
$RegularChannels = @("Ground Speed", "Throttle Pos", "Brake Pos", "GPS Latitude", "GPS Longitude", "G Force Lat", "G Force Long")
$IrregularChannels = @("Gear")
$AllowedChannels = $RegularChannels + $IrregularChannels

# Small in-memory cache so repeated requests against the same file don't re-run
# metadata/frequency lookups every time.
$SessionCache = @{}

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

    $metaJson = Invoke-DuckDb $DbPath "SELECT key, value FROM metadata WHERE key != 'CarSetup';"
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
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = "application/json; charset=utf-8"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Write-FileResponse {
    param($Context, [string]$Path)
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
    $Context.Response.OutputStream.Close()
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
                $files = Get-ChildItem -Path $TelemetryDir -Filter "*.duckdb" -File | Sort-Object LastWriteTime -Descending
                $list = @()
                foreach ($f in $files) {
                    # Expected pattern: "<Track>_<SessionType>_<ISO timestamp>.duckdb"
                    $name = $f.BaseName
                    $track = $name
                    $sessionType = ""
                    $m = [regex]::Match($name, '^(?<track>.+)_(?<type>[A-Za-z]+)_(?<ts>\d{4}-\d{2}-\d{2}T.+)$')
                    if ($m.Success) {
                        $track = $m.Groups['track'].Value
                        $sessionType = $m.Groups['type'].Value
                    }
                    $list += [PSCustomObject]@{
                        file        = $f.Name
                        track       = $track
                        sessionType = $sessionType
                        modified    = $f.LastWriteTime.ToString("o")
                        sizeMB      = [math]::Round($f.Length / 1MB, 1)
                    }
                }
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
